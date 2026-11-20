import {
  Color, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedMesh,
  Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3,
} from 'three';
import { CLIFF_LIMITS } from './config.js';
import { addCliffSurfaceAttributes, applyCliffWear } from './cliff-surface.js';

const PERIOD = 360;
const EDGE_MARGIN = 260;
const SURFACE_CLEARANCE = 0.1;
const MAX_CLIFF_FRONT_Z = -0.75;
const LAYERS = [
  {
    key: 'far', name: 'Distant cliffs', grade: [1.08, 1.42, 1.82],
    rocks: [
      { x: 24, y: 36, width: 138, height: 228, depth: 18, yaw: 0.28, lean: -0.20 },
      { x: 117, y: 139, width: 116, height: 234, depth: 16, yaw: 2.75, lean: 0.17 },
      { x: 27, y: 214, width: 146, height: 225, depth: 19, yaw: -0.48, lean: -0.08 },
      { x: 102, y: 314, width: 118, height: 246, depth: 18, yaw: 3.36, lean: 0.26 },
    ],
  },
  {
    key: 'near', name: 'Near cliffs', grade: [1.02, 1.16, 1.38],
    rocks: [
      { x: -11, y: 40, width: 135, height: 190, depth: 19, yaw: 0.11, lean: -0.17 },
      { x: 119, y: 116, width: 116, height: 176, depth: 22, yaw: 3.03, lean: 0.16 },
      { x: -16, y: 222, width: 144, height: 213, depth: 21, yaw: -0.29, lean: 0.05 },
      { x: 134, y: 307, width: 159, height: 210, depth: 20, yaw: 3.38, lean: -0.10 },
    ],
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fitDepth(z, compressionStart) {
  if (z <= compressionStart) return z;
  const clearance = MAX_CLIFF_FRONT_Z - compressionStart;
  return MAX_CLIFF_FRONT_Z - clearance * Math.exp((compressionStart - z) / clearance);
}

function placeRock(geometry, rock, unit, scale, frontZ, compressionStart, transform) {
  const size = unit * scale;
  transform.position.set(rock.x * unit, 0, 0);
  transform.scale.set(rock.width * size, rock.height * size, rock.depth * size);
  transform.rotation.set(0, rock.yaw, rock.lean);
  transform.updateMatrix();
  const matrix = transform.matrix.clone();
  const elements = matrix.elements;
  const positions = geometry.getAttribute('position');
  let front = -Infinity;
  let back = Infinity;
  for (let i = 0; i < positions.count; i += 1) {
    const z = elements[2] * positions.getX(i) + elements[6] * positions.getY(i) + elements[10] * positions.getZ(i);
    front = Math.max(front, z);
    back = Math.min(back, z);
  }
  // Fit both ends in depth so very close rocks retain a closed surface.
  const thickness = front - back;
  const fittedFront = fitDepth(frontZ, compressionStart);
  const fittedBack = fitDepth(frontZ - thickness, compressionStart);
  const depthScale = (fittedFront - fittedBack) / thickness;
  elements[2] *= depthScale;
  elements[6] *= depthScale;
  elements[10] *= depthScale;
  elements[14] = fittedFront - front * depthScale;
  return { y: rock.y * unit, matrix, backZ: fittedBack };
}

function makeSky() {
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(12), 3));
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
}

function shadeRock(source, layer) {
  const geometry = source.clone();
  const colors = geometry.getAttribute('color');
  const normals = geometry.getAttribute('normal');
  const normal = new Vector3();
  const light = new Vector3(-0.55, 0.68, 0.48).normalize();
  const color = new Color();
  const grade = new Color(...layer.grade);
  // Set the contrast here so game lighting controls do not flatten the rock palette.
  for (let i = 0; i < colors.count; i += 1) {
    normal.fromBufferAttribute(normals, i);
    const brightness = 0.66 + 0.49 * Math.max(0, normal.dot(light));
    color.fromBufferAttribute(colors, i).multiplyScalar(brightness).multiply(grade);
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  return geometry;
}

export class CliffBackground {
  constructor(source, atmosphere, wearTexture) {
    this.group = new Group();
    this.group.name = 'Cliff background';
    this.sky = makeSky();
    this.group.add(this.sky);
    this.layers = LAYERS.map((layer) => {
      const geometry = shadeRock(source, layer);
      const material = new MeshBasicMaterial({ vertexColors: true });
      if (wearTexture) {
        addCliffSurfaceAttributes(geometry, 0, 90);
        applyCliffWear(material, wearTexture, layer.key === 'near' ? 0.28 : 0.14);
      }
      return {
        ...layer,
        geometry,
        baseColors: geometry.getAttribute('color').array.slice(),
        material,
        mesh: null,
        previousTravel: 0,
        travel: 0,
      };
    });
    this.transform = new Object3D();
    this.setAtmosphere(atmosphere);
  }

  setAtmosphere(settings) {
    const top = new Color(clamp(settings.skyTop, 0, 0xffffff));
    const bottom = new Color(clamp(settings.skyBottom, 0, 0xffffff));
    const gradient = this.sky.geometry.getAttribute('color');
    for (const [i, color] of [top, top, bottom, bottom].entries()) gradient.setXYZ(i, color.r, color.g, color.b);
    gradient.needsUpdate = true;

    const color = new Color();
    for (const layer of this.layers) {
      const haze = new Color(clamp(settings[`${layer.key}HazeColor`], 0, 0xffffff));
      const amount = clamp(settings[`${layer.key}HazeAmount`], 0, 1);
      const colors = layer.geometry.getAttribute('color');
      for (let i = 0; i < colors.count; i += 1) {
        color.fromArray(layer.baseColors, i * 3).lerp(haze, amount);
        colors.setXYZ(i, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
    }
  }

  resize(width, worldHeight, platformDepth, settings) {
    this.worldHeight = worldHeight;
    this.unit = width / 120;
    const { unit } = this;
    const platformBack = -platformDepth / 2 - SURFACE_CLEARANCE;
    const compressionStart = Math.min(platformBack + 2, MAX_CLIFF_FRONT_Z - 1);
    let skyZ = -118 * unit;
    let largestScale = 1;
    for (const layer of this.layers) {
      const scale = clamp(settings[`${layer.key}Scale`], CLIFF_LIMITS.minScale, CLIFF_LIMITS.maxScale);
      const gap = clamp(settings[`${layer.key}Gap`], CLIFF_LIMITS.minGap, CLIFF_LIMITS.maxGap);
      const frontZ = platformBack - gap;
      layer.speed = clamp(settings[`${layer.key}Speed`], 0, CLIFF_LIMITS.maxSpeed);
      layer.renderedTravel = null;
      largestScale = Math.max(scale, largestScale);
      layer.placements = layer.rocks.map((rock) => placeRock(
        layer.geometry, rock, unit, scale, frontZ, compressionStart, this.transform,
      ));
      for (const rock of layer.placements) skyZ = Math.min(skyZ, rock.backZ - 12 * unit);
    }
    this.sky.position.set(width / 2, worldHeight / 2, skyZ);
    const skyScale = Math.max(1, -skyZ / (118 * unit));
    this.sky.scale.set(width * 3 * skyScale, worldHeight * 2.4 * skyScale, 1);
    this.margin = EDGE_MARGIN * unit * largestScale;
    this.repeats = Math.ceil((worldHeight + 2 * this.margin) / (PERIOD * unit)) + 1;
    for (const layer of this.layers) {
      const count = layer.placements.length * this.repeats;
      if (layer.mesh?.instanceMatrix.count === count) continue;
      if (layer.mesh) {
        this.group.remove(layer.mesh);
        layer.mesh.dispose();
      }
      const mesh = new InstancedMesh(layer.geometry, layer.material, count);
      mesh.name = layer.name;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      layer.mesh = mesh;
    }
    this.render(this.renderAlpha);
  }

  reset() {
    for (const layer of this.layers) layer.travel = layer.previousTravel = 0;
  }

  capture() {
    for (const layer of this.layers) layer.previousTravel = layer.travel;
  }

  advance(distance) {
    for (const layer of this.layers) layer.travel += distance * layer.speed;
  }

  render(alpha = 1) {
    const { unit, worldHeight, repeats, margin } = this;
    const period = PERIOD * unit;
    this.renderAlpha = alpha;
    for (const layer of this.layers) {
      // Integrate travel per layer so editing its speed never changes its current position.
      const travel = layer.previousTravel + (layer.travel - layer.previousTravel) * alpha;
      if (travel === layer.renderedTravel) continue;
      layer.renderedTravel = travel;
      // Wrap the repeating layout outside the camera so a whole cliff can pass an edge.
      const firstTop = Math.floor((travel - margin) / period) * period - travel;
      let index = 0;
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const top = firstTop + period * repeat;
        for (const rock of layer.placements) {
          const center = top + rock.y;
          if (center < -margin || center > worldHeight + margin) continue;
          rock.matrix.elements[13] = worldHeight - center;
          layer.mesh.setMatrixAt(index++, rock.matrix);
        }
      }
      layer.mesh.count = index;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
