import {
  BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, RepeatWrapping,
  SRGBColorSpace, TextureLoader, Vector4,
} from 'three';
import { FOLIAGE_WIND_LIMITS } from './config.js';
import { SeededRandom } from './rng.js';

const atlasWidth = 1024;
const atlasHeight = 512;
const plantScale = 1.5;
const plantEdgeInset = 0.04;
const bendPerStrength = 0.35;
const softBendStart = 1.4;
const extraBendRange = 0.7;
const maxBendAngle = softBendStart + extraBendRange;
const fullTurn = Math.PI * 2;
const grassTileWidth = 116;
const grassTileDepth = 28;
const atlasFrames = {
  broadGrass: [10, 78, 236, 99],
  tallGrass: [266, 35, 236, 185],
  ivy: [522, 17, 236, 221],
  vine: [833, 10, 125, 236],
  daisies: [10, 318, 236, 132],
  lupines: [266, 266, 236, 235],
};

const plantSizes = {
  broadGrass: { height: 3.6 },
  tallGrass: { height: 4.3 },
  ivy: { height: 12.5, hanging: true },
  vine: { height: 15, hanging: true },
  daisies: { height: 5.9 },
  lupines: { height: 6.6 },
};

const fixedLayouts = {
  hub: {
    noiseX: -2, noiseY: 14 / 24, patches: [
      { fraction: 0.21, plants: [['broadGrass', -6.5], ['daisies', 1.6], ['ivy', 3.0]] },
      { fraction: 0.81, plants: [['tallGrass', -3.4], ['lupines', 2.3]] },
    ],
  },
  landing: {
    noiseX: 44, noiseY: 9 / 16, side: -1, windPhase: 2, patches: [
      { fraction: 0.69, plants: [['tallGrass', -2, 4.7 / plantSizes.tallGrass.height], ['vine', 2.6]] },
    ],
  },
};

// Centers of two grass islands in the baked noise, in the same coordinates as the projection.
const grassIslands = [[22, 14 / 24], [71, 9 / 16]];

function routeLayout(width, seed) {
  const random = new SeededRandom(seed);
  const fraction = random.between(0.33, 0.67);
  const direction = random.next() < 0.5 ? -1 : 1;
  const scale = Math.min(1, width / 35) * random.between(0.85, 1.12);
  const [islandX, noiseY] = grassIslands[Math.floor(random.next() * grassIslands.length)];
  const noiseSlope = direction / scale;
  const grass = random.next() < 0.5 ? 'broadGrass' : 'tallGrass';
  const flower = random.next() < 0.5 ? 'daisies' : 'lupines';
  const vine = random.next() < 0.5 ? 'ivy' : 'vine';
  const arrangement = random.next();
  const plants = [[grass, -3.2]];
  if (arrangement < 0.72) plants.push([flower, 3]);
  if (arrangement >= 0.47) plants.push([vine, arrangement < 0.72 ? 1.8 : 3]);
  return {
    noiseX: islandX - width * fraction * noiseSlope,
    noiseY,
    noiseSlope,
    plantOffset: scale * direction,
    plantSize: scale,
    side: random.next() < 0.5 ? -1 : 1,
    windPhase: random.between(0, fullTurn),
    patches: [{ fraction, plants }],
  };
}

export async function loadPlatformFoliage(atlasUrl, noiseUrl) {
  const loader = new TextureLoader();
  const [atlas, noise] = await Promise.all([loader.loadAsync(atlasUrl), loader.loadAsync(noiseUrl)]);
  atlas.colorSpace = SRGBColorSpace;
  noise.wrapS = RepeatWrapping;
  noise.wrapT = RepeatWrapping;
  return { atlas, noise };
}

function frameUV(frame) {
  const [x, y, width, height] = atlasFrames[frame];
  return new Vector4(x / atlasWidth, 1 - (y + height) / atlasHeight, width / atlasWidth, height / atlasHeight);
}

function lineSide([ax, ay], [bx, by], x, y) {
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
}

function upperStoneFaces(stone, tilt = 0) {
  const points = stone.geometry.getAttribute('position');
  const faces = [];
  for (let i = 0; i < points.count; i += 3) {
    const triangle = [i, i + 1, i + 2].map((index) => [
      points.getX(index) * stone.scale.x,
      points.getY(index) * stone.scale.y,
      points.getZ(index) * stone.scale.z,
    ]);
    const projected = triangle.map(([x, y, z]) => [x, z - y * tilt]);
    const [a, b, c] = projected;
    const area = lineSide(a, b, ...c);
    if (area < -1e-5) faces.push({ triangle, projected, area });
  }
  return faces;
}

function stoneHeightAt(faces, x, v) {
  let hit = null;
  for (const { triangle, projected: [a, b, c], area } of faces) {
    const wa = lineSide(b, c, x, v) / area;
    const wb = lineSide(c, a, x, v) / area;
    const wc = 1 - wa - wb;
    if (Math.min(wa, wb, wc) < -1e-5) continue;
    const y = triangle[0][1] * wa + triangle[1][1] * wb + triangle[2][1] * wc;
    if (hit === null || y > hit) hit = y;
  }
  return hit;
}

function makeSpriteGeometry(stone, layout, edge, width, lip) {
  const positions = [];
  const uvs = [];
  const wind = [];
  const indices = [];
  let longestPlant = 0;
  const depth = stone.scale.z;
  const { patches, plantOffset = 1, plantSize = 1, side = 1, windPhase = 0 } = layout;
  const upperFaces = upperStoneFaces(stone);
  const frontFaces = upperStoneFaces(stone, 1);
  const standingDepth = side * depth * (0.5 - plantEdgeInset);
  for (const { fraction, plants } of patches) {
    for (const [sprite, offset, size = 1] of plants) {
      const { height: baseHeight, hanging } = plantSizes[sprite];
      const x = edge + width * fraction + offset * plantOffset;
      const y = hanging
        ? stoneHeightAt(frontFaces, x, lip - 0.35)
        : stoneHeightAt(upperFaces, x, standingDepth);
      if (y === null) continue;
      const height = baseHeight * plantScale * plantSize * size;
      longestPlant = Math.max(longestPlant, height);
      const [, , imageWidth, imageHeight] = atlasFrames[sprite];
      const halfWidth = height * imageWidth / imageHeight / 2;
      const front = hanging ? depth / 2 + 0.12 : standingDepth;
      const bottom = hanging ? y + 1.3 - height : y - 0.25;
      const { x: u, y: v, z: du, w: dv } = frameUV(sprite);
      const start = positions.length / 3;
      const phase = windPhase + (x - edge) * 0.075;
      const segments = hanging ? 5 : 3;
      for (let row = 0; row <= segments; row += 1) {
        const t = row / segments;
        const rowY = bottom + height * t;
        const progress = hanging ? 1 - t : t;
        const distance = (hanging ? -height : height) * progress;
        positions.push(x - halfWidth, rowY, front, x + halfWidth, rowY, front);
        uvs.push(u, v + t * dv, u + du, v + t * dv);
        wind.push(distance, progress, phase, distance, progress, phase);
        if (row === 0) continue;
        const i = start + (row - 1) * 2;
        indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('plantWind', new Float32BufferAttribute(wind, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  // Account for shader displacement when a plant sways into view from offscreen.
  geometry.boundingSphere.radius += longestPlant * (maxBendAngle / 2 + 0.02);
  return geometry;
}

function fitGrassCoordinates(stone, layout, edge, lip) {
  const { x, y, z } = stone.scale;
  const geometry = stone.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const { noiseX, noiseY, noiseSlope = 1, side = 1 } = layout;
  let coordinates = geometry.getAttribute('platformGrass');
  if (!coordinates) {
    coordinates = new Float32BufferAttribute(new Float32Array(positions.count * 3), 3);
    geometry.setAttribute('platformGrass', coordinates);
  }
  // Bake the oblique projection once per fit so all stones can share one material.
  for (let i = 0; i < positions.count; i += 1) {
    const u = noiseX + (positions.getX(i) * x - edge) * noiseSlope;
    const v = positions.getZ(i) * z * side - positions.getY(i) * y - lip;
    const nx = normals.getX(i) / x;
    const ny = normals.getY(i) / y;
    const nz = normals.getZ(i) / z;
    const facing = (ny + nz * side) / (Math.hypot(nx, ny, nz) || 1);
    coordinates.setXYZ(i, u / grassTileWidth, noiseY + v / grassTileDepth, facing);
  }
  coordinates.needsUpdate = true;
}

function makeGrassMaterial(baseMaterial, noise) {
  const material = baseMaterial.clone();
  const grassEdge = new Color(0x7f8c48);
  const grassCore = new Color(0x9fa94f);
  material.customProgramCacheKey = () => 'platform-grass-noise';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassNoise = { value: noise };
    shader.uniforms.grassEdge = { value: grassEdge };
    shader.uniforms.grassCore = { value: grassCore };
    shader.vertexShader = `
      attribute vec3 platformGrass;
      varying vec2 grassUV;
      varying vec2 grassSurface;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      grassUV = platformGrass.xy;
      grassSurface = vec2(platformGrass.z, position.y);
    `);
    shader.fragmentShader = `
      uniform sampler2D grassNoise;
      uniform vec3 grassEdge;
      uniform vec3 grassCore;
      varying vec2 grassUV;
      varying vec2 grassSurface;
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float grassValue = texture2D(grassNoise, grassUV).r;
      float grassCoverage = smoothstep(0.55, 0.65, grassValue)
        * smoothstep(0.0, 0.35, grassSurface.x)
        * smoothstep(-0.23, 0.28, grassSurface.y);
      vec3 grassTint = mix(grassEdge, grassCore, smoothstep(0.59, 0.84, grassValue));
      diffuseColor.rgb = mix(diffuseColor.rgb, grassTint, grassCoverage);
    `);
  };
  return material;
}

export class PlatformFoliage {
  constructor(stoneMaterial, { atlas, noise }) {
    this.entries = new WeakMap();
    this.grassMaterial = makeGrassMaterial(stoneMaterial, noise);
    this.windPhase = { value: 0 };
    this.windStrength = { value: 0 };
    this.windSway = { value: 0 };
    this.windGustiness = { value: 0 };
    this.windSpeed = 0;
    this.plantMaterial = new MeshBasicMaterial({
      name: 'Painted platform plants',
      map: atlas,
      alphaTest: 0.28,
    });
    this.plantMaterial.customProgramCacheKey = () => 'platform-plant-wind';
    this.plantMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.foliageWindPhase = this.windPhase;
      shader.uniforms.foliageWindStrength = this.windStrength;
      shader.uniforms.foliageWindSway = this.windSway;
      shader.uniforms.foliageWindGustiness = this.windGustiness;
      shader.vertexShader = `
        uniform float foliageWindPhase;
        uniform float foliageWindStrength;
        uniform float foliageWindSway;
        uniform float foliageWindGustiness;
        attribute vec3 plantWind;
      ` + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float hanging = step(plantWind.x, 0.0);
        float lag = mix(0.45, 1.65, hanging) * plantWind.y;
        float cycle = foliageWindPhase + plantWind.z * 0.5;
        float sway = 0.215 * sin(2.0 * cycle - lag) + 0.055 * sin(3.0 * cycle - lag * 1.3 + 0.7);
        float gust = 0.5 + 0.5 * sin(cycle - lag * 0.45 + 0.6);
        float pressure = 0.47 + foliageWindSway * sway + 0.26 * foliageWindGustiness * gust * gust;
        // Ease extreme values into the bend limit without flattening the peaks.
        float positivePressure = 0.5 * (pressure + sqrt(pressure * pressure + 0.0025));
        float rawBend = foliageWindStrength * ${bendPerStrength}
          * positivePressure * mix(0.68, 1.0, hanging) * plantWind.y;
        float excess = max(0.0, rawBend - ${softBendStart});
        float bend = rawBend - excess + excess / (1.0 + excess / ${extraBendRange});
        float bendSquared = bend * bend;
        // Circular arc offsets keep the tips lifting as they swing, with a fixed root.
        float sideways = bend * (0.5 - bendSquared * (1.0 / 24.0 - bendSquared / 720.0));
        float shorten = bendSquared * (1.0 / 6.0 - bendSquared * (1.0 / 120.0 - bendSquared / 5040.0));
        transformed.x -= abs(plantWind.x) * sideways;
        transformed.y -= plantWind.x * shorten;
      `);
    };
  }

  setWind({ enabled, strength, speed, sway, gustiness }) {
    this.windStrength.value = enabled ? Math.max(0, Math.min(FOLIAGE_WIND_LIMITS.maxStrength, strength)) : 0;
    this.windSpeed = Math.max(0, Math.min(FOLIAGE_WIND_LIMITS.maxSpeed, speed));
    this.windSway.value = Math.max(0, Math.min(FOLIAGE_WIND_LIMITS.maxSway, sway));
    this.windGustiness.value = Math.max(0, Math.min(FOLIAGE_WIND_LIMITS.maxGustiness, gustiness));
  }

  update(dt) {
    if (this.windStrength.value === 0) return;
    // The main sway completes two cycles for every gust.
    this.windPhase.value = (this.windPhase.value + dt * this.windSpeed * Math.PI) % fullTurn;
  }

  fit(stone, leftExtension, width, layoutKey) {
    const { x, y, z } = stone.scale;
    let entry = this.entries.get(stone);
    if (entry && entry.layoutKey === layoutKey && entry.width === width && entry.left === leftExtension
      && entry.x === x && entry.y === y && entry.z === z) return;
    const edge = leftExtension - x / 2;
    const lip = (z - y) / 2;
    const layout = fixedLayouts[layoutKey] ?? routeLayout(width, layoutKey);
    fitGrassCoordinates(stone, layout, edge, lip);
    const geometry = makeSpriteGeometry(stone, layout, edge, width, lip);
    if (entry) {
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = geometry;
    } else {
      const mesh = new Mesh(geometry, this.plantMaterial);
      mesh.name = 'Painted platform plants';
      stone.add(mesh);
      stone.material = this.grassMaterial;
      entry = { mesh };
      this.entries.set(stone, entry);
    }
    entry.mesh.scale.set(1 / x, 1 / y, 1 / z);
    Object.assign(entry, { layoutKey, width, left: leftExtension, x, y, z });
  }
}
