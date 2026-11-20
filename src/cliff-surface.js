import { BufferAttribute, RepeatWrapping, TextureLoader } from 'three';

export async function loadCliffWear(url) {
  const texture = await new TextureLoader().loadAsync(url);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

export function addCliffSurfaceAttributes(geometry, start = 0, scale = 1) {
  const { position, normal } = geometry.attributes;
  const positions = position.array;
  const normals = normal.array;
  const facetIds = geometry.userData.facetIds;
  const distances = new Float32Array(positions.length).fill(8);
  const strengths = new Float32Array(positions.length);
  const cornerDistances = new Float32Array(positions.length);
  const cornerStrengths = new Float32Array(positions.length);
  const uv = new Float32Array(position.count * 2);
  const lines = new Map();
  const joints = new Map();
  const lineKey = (values) => values.map((value) => Math.round(value * 1000)).join(',');
  const pointKey = (offset) => lineKey([positions[offset], positions[offset + 1], positions[offset + 2]]);
  for (let face = 0; face < positions.length; face += 9) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = face + ((corner + 1) % 3) * 3;
      const b = face + ((corner + 2) % 3) * 3;
      const tip = face + corner * 3;
      const dx = positions[b] - positions[a];
      const dy = positions[b + 1] - positions[a + 1];
      const dz = positions[b + 2] - positions[a + 2];
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-5) continue;
      const sign = (Math.abs(dx) > length * 0.001 ? dx : Math.abs(dy) > length * 0.001 ? dy : dz) < 0 ? -1 : 1;
      const x = sign * dx / length;
      const y = sign * dy / length;
      const z = sign * dz / length;
      const projection = positions[a] * x + positions[a + 1] * y + positions[a + 2] * z;
      const key = lineKey([x, y, z, positions[a] - projection * x, positions[a + 1] - projection * y, positions[a + 2] - projection * z]);
      const end = projection + sign * length;
      const px = positions[tip] - positions[a];
      const py = positions[tip + 1] - positions[a + 1];
      const pz = positions[tip + 2] - positions[a + 2];
      const altitude = Math.hypot(y * pz - z * py, z * px - x * pz, x * py - y * px);
      const edge = { face, corner, a, b, tip, start: Math.min(projection, end), end: Math.max(projection, end), altitude, sign };
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(edge);
    }
  }
  for (const edges of lines.values()) {
    for (const edge of edges) {
      let strength = 0;
      for (const other of edges) {
        if (edge.sign === other.sign || Math.min(edge.end, other.end) - Math.max(edge.start, other.start) <= 0.0001) continue;
        const dot = normals[edge.face] * normals[other.face]
          + normals[edge.face + 1] * normals[other.face + 1]
          + normals[edge.face + 2] * normals[other.face + 2];
        const facet = facetIds?.[edge.face / 9];
        const neighbor = facetIds?.[other.face / 9];
        if (facet && facet === neighbor) continue;
        const authoredBreak = Boolean(facet && neighbor);
        // Preserve shallow, intentional folds between sculpted facets.
        if (dot > (authoredBreak ? 0.9992 : 0.975) || dot < -0.97) continue;
        const side = normals[edge.face] * (positions[other.tip] - positions[edge.a])
          + normals[edge.face + 1] * (positions[other.tip + 1] - positions[edge.a + 1])
          + normals[edge.face + 2] * (positions[other.tip + 2] - positions[edge.a + 2]);
        const angularWeight = Math.min(1, (0.975 - dot) / 0.20);
        const weight = authoredBreak ? Math.max(0.46, angularWeight) : angularWeight;
        strength = Math.max(strength, weight * (side < 0 ? 1 : authoredBreak ? 0.67 : 0.28));
      }
      if (strength === 0) continue;
      const { a, b, tip, corner, altitude } = edge;
      distances[a + corner] = distances[b + corner] = 0;
      distances[tip + corner] = altitude * scale;
      strengths[a + corner] = strengths[b + corner] = strengths[tip + corner] = strength;
      for (const offset of [a, b]) {
        const key = pointKey(offset);
        joints.set(key, Math.max(joints.get(key) ?? 0, strength));
      }
    }
  }
  // Let an edge round into neighboring triangles at its vertex. Otherwise its
  // falloff is cropped by the diagonal of the triangle that carries the edge.
  for (let face = 0; face < positions.length; face += 9) {
    for (let corner = 0; corner < 3; corner += 1) {
      const tip = face + corner * 3;
      const strength = joints.get(pointKey(tip)) ?? 0;
      if (!strength) continue;
      for (let offset = face; offset < face + 9; offset += 3) {
        cornerDistances[offset + corner] = Math.hypot(
          positions[offset] - positions[tip],
          positions[offset + 1] - positions[tip + 1],
          positions[offset + 2] - positions[tip + 2],
        ) * scale;
        cornerStrengths[offset + corner] = strength;
      }
    }
  }
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + 0.58 * position.getZ(i)) * scale / 38;
    uv[i * 2 + 1] = ((position.getY(i) + 0.32 * position.getZ(i)) * scale - start) / 56;
  }
  geometry.setAttribute('cliffEdgeDistance', new BufferAttribute(distances, 3));
  geometry.setAttribute('cliffEdgeStrength', new BufferAttribute(strengths, 3));
  geometry.setAttribute('cliffCornerDistance', new BufferAttribute(cornerDistances, 3));
  geometry.setAttribute('cliffCornerStrength', new BufferAttribute(cornerStrengths, 3));
  geometry.setAttribute('cliffWearUV', new BufferAttribute(uv, 2));
}
export function applyCliffWear(material, texture, intensity = 1) {
  material.customProgramCacheKey = () => 'cliff-edge-wear';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cliffWear = { value: texture };
    shader.uniforms.cliffWearIntensity = { value: intensity };
    shader.vertexShader = `
      attribute vec3 cliffEdgeDistance;
      attribute vec3 cliffEdgeStrength;
      attribute vec3 cliffCornerDistance;
      attribute vec3 cliffCornerStrength;
      attribute vec2 cliffWearUV;
      varying vec3 wearEdgeDistance;
      varying vec3 wearEdgeStrength;
      varying vec3 wearCornerDistance;
      varying vec3 wearCornerStrength;
      varying vec2 wearUV;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      wearEdgeDistance = cliffEdgeDistance;
      wearEdgeStrength = cliffEdgeStrength;
      wearCornerDistance = cliffCornerDistance;
      wearCornerStrength = cliffCornerStrength;
      wearUV = cliffWearUV;
    `);
    shader.fragmentShader = `
      uniform sampler2D cliffWear;
      uniform float cliffWearIntensity;
      varying vec3 wearEdgeDistance;
      varying vec3 wearEdgeStrength;
      varying vec3 wearCornerDistance;
      varying vec3 wearCornerStrength;
      varying vec2 wearUV;
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float wear = texture2D(cliffWear, wearUV).r;
      vec3 edgeCore = vec3(1.0) - smoothstep(vec3(0.08), vec3(0.62 + 0.45 * wear), wearEdgeDistance);
      vec3 edgeFalloff = vec3(1.0) - smoothstep(vec3(0.1), vec3(1.7 + 1.5 * wear), wearEdgeDistance);
      vec3 highlight = (0.64 * edgeCore + 0.36 * edgeFalloff) * wearEdgeStrength;
      vec3 joint = (1.0 - smoothstep(vec3(0.04), vec3(0.75 + 0.8 * wear), wearCornerDistance)) * wearCornerStrength;
      highlight = max(highlight, joint);
      float edgeLight = max(max(highlight.x, highlight.y), highlight.z) * (0.48 + 0.52 * wear);
      diffuseColor.rgb *= mix(1.0, 0.9 + wear * 0.22, cliffWearIntensity);
      diffuseColor.rgb += edgeLight * cliffWearIntensity * vec3(0.091, 0.093, 0.120);
    `);
    if (material.isMeshStandardMaterial) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        totalEmissiveRadiance += edgeLight * cliffWearIntensity * vec3(0.007, 0.008, 0.012);
      `);
    }
  };
}
