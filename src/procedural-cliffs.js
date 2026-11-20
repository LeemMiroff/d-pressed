import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, ShapeUtils, Vector2, Vector3 } from 'three';

const SECTION_HEIGHT = 150;
const ROCK_RELIEF = 3;
const BREAK_INTERVAL = 184;
const SEAM_PRECISION = 65536;
const RECESS_DEPTH = 0.31;
const RECESS_VARIATION = 0.08;
const MIN_RETURN_DEPTH = 0.025;
const SEAM_OFFSET_LIMIT = 24;
const ROCK_COLOR = 0x59617e;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

export function maximumCliffRecess(width, settings = {}) {
  const configured = width * (RECESS_DEPTH + RECESS_VARIATION / 2) * clamp(settings.recessDepth ?? 1, 0.6, 1.4);
  const detail = clamp(settings.fractureStrength ?? 0.58, 0, 1);
  // The loft also needs room to recede behind the deepest possible front edge.
  const spine = Math.max(1.7 + mix(5, 22, detail) / 2, width * 0.0736 - ROCK_RELIEF);
  return Math.max(configured, spine + width * (0.256 + MIN_RETURN_DEPTH) + 0.65);
}

function noise(seed, key) {
  let bits = Math.imul(seed ^ key, 0x9e3779b1);
  bits = Math.imul(bits ^ (bits >>> 16), 0x85ebca6b);
  return ((bits ^ (bits >>> 13)) >>> 0) / 4294967296;
}

function fracture(y, spacing, seed) {
  const unit = y / spacing;
  const index = Math.floor(unit);
  return mix(noise(seed, index), noise(seed, index + 1), unit - index) - 0.5;
}

function seamLean(y, seed) {
  const direction = noise(seed, 661) < 0.5 ? -1 : 1;
  return direction * (21 + 15 * fracture(y, 180, seed ^ 920));
}

function seamOffset(x, width, seed, origin) {
  return seamLean(origin, seed) * (x / width - 0.5);
}

function meshHeight(x, y, width, seed, origin) {
  return y - seamOffset(x, width, seed, origin);
}

function profile(y, width, settings, seed, origin) {
  const phase = noise(seed, 712) * Math.PI * 2;
  const center = width * (0.5 + 0.15 * Math.sin(y / 116 + phase) + 0.08 * Math.sin(y / 48 - phase));
  const coverage = clamp(settings.rockCoverage, 0.25, 0.95);
  const opening = clamp(settings.openingSize, 0.15, 0.68);
  const variation = 0.91 + 0.19 * Math.sin(y / 69 + phase) + 0.11 * Math.sin(y / 29 - phase);
  const gap = width * (0.29 + opening * 0.75) * (1.32 - coverage * 0.55) * variation;
  const irregularity = mix(0.42, 1.42, clamp(settings.fractureStrength ?? 0.58, 0, 1));
  const leftBreak = width * (0.16 * fracture(y, 35, seed ^ 149) + 0.14 * fracture(y, 69, seed ^ 635)) * irregularity;
  const rightBreak = width * (0.18 * fracture(y + 24, 39, seed ^ 852) + 0.11 * fracture(y, 82, seed ^ 117)) * irregularity;
  const localY = y - origin - 35;
  const interval = Math.floor(localY / BREAK_INTERVAL);
  const middle = (interval + 0.5) * BREAK_INTERVAL + (noise(seed, interval ^ 591) - 0.5) * 20;
  const edgeFade = smooth(1 - clamp((Math.abs(localY - middle) - 14) / (33 + opening * 22), 0, 1));
  const left = center - gap / 2 + leftBreak;
  const right = center + gap / 2 + rightBreak;
  // The landform continues just outside the camera in alternate side openings.
  return interval % 2 === 0
    ? [mix(left, -width * 0.20, edgeFade), right]
    : [left, mix(right, width * 1.20, edgeFade)];
}

function bridgeFor(section, start, seed) {
  const block = Math.floor(section / 3);
  const slot = block === 0 ? 0 : Math.floor(noise(seed, block ^ 842) * 2);
  if (section !== block * 3 + slot) return null;
  const top = start + 28 + noise(seed, section + 301) * 12;
  const high = [top, top + 27 + noise(seed, section + 811) * 10];
  const lowTop = top + 19 + noise(seed, section + 931) * 12;
  const low = [lowTop, lowTop + 18 + noise(seed, section + 897) * 10];
  return noise(seed, section ^ 317) < 0.5 ? { left: high, right: low } : { left: low, right: high };
}

function mountingPoint(ledge, width, settings, seed, origin) {
  const centerX = ledge.x + ledge.width / 2;
  const [left, right] = profile(meshHeight(centerX, ledge.y, width, seed, origin), width, settings, seed, origin);
  const overlap = clamp(ledge.width * 0.27, 3, 14);
  const leftReach = ledge.x + overlap;
  const rightReach = ledge.x + ledge.width - overlap;
  const leftDistance = Math.max(0, leftReach - left);
  const rightDistance = Math.max(0, right - rightReach);
  const leftBank = leftDistance === rightDistance
    ? ledge.x + ledge.width / 2 < (left + right) / 2
    : leftDistance < rightDistance;
  const reach = leftBank ? leftReach : rightReach;
  const y = meshHeight(reach, ledge.y, width, seed, origin);
  const [leftEdge, rightEdge] = profile(y, width, settings, seed, origin);
  const extension = leftBank ? reach - leftEdge : rightEdge - reach;
  const blend = clamp(settings.mountBlend ?? 1, 0.65, 1.4);
  // A wall reaching far into a gap meets the ledge with a short face.
  const capBefore = extension >= 12 ? 2.6 * blend : 0;
  const capAfter = extension >= 12 ? 4.4 * blend : 0;
  return { ...ledge, worldY: ledge.y, y, leftBank, reach, capBefore, capAfter };
}

function bankEdges(y, width, settings, seed, origin, mounts) {
  const [left, right] = profile(y, width, settings, seed, origin);
  let leftRock = left;
  let rightRock = right;
  const blend = clamp(settings.mountBlend ?? 1, 0.65, 1.4);
  for (const mount of mounts) {
    const offset = y - mount.y;
    const span = (offset < 0 ? 11 : 19) * blend;
    const cap = offset < 0 ? mount.capBefore : mount.capAfter;
    const slope = clamp((Math.abs(offset) - cap) / (span - cap), 0, 1);
    const weight = 1 - smooth(slope);
    if (mount.leftBank) leftRock = Math.max(leftRock, mix(left, mount.reach, weight));
    else rightRock = Math.min(rightRock, mix(right, mount.reach, weight));
  }
  if (rightRock - leftRock < 2) {
    const middle = (rightRock + leftRock) / 2;
    leftRock = middle - 1;
    rightRock = middle + 1;
  }
  const leftEdge = -width * 0.30;
  const rightEdge = width * 1.30;
  leftRock = clamp(leftRock, leftEdge + 1, rightEdge - 3);
  rightRock = clamp(rightRock, leftRock + 2, rightEdge - 1);
  return [leftRock, rightRock];
}

function projectedArea(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function distanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function triangulateStrip(first, second, surfacePoint, emit) {
  const cost = (first, second, third) => {
    const a = surfacePoint(first);
    const b = surfacePoint(second);
    const c = surfacePoint(third);
    const area = projectedArea(a, b, c);
    const perimeter = distanceSquared(a, b) + distanceSquared(b, c) + distanceSquared(c, a);
    return perimeter / Math.max(area, 0.01);
  };
  // Find a complete strip before picking diagonals, so a short edge cannot
  // force a fan of thin triangles or turn the last triangle inside out.
  const costs = first.map(() => new Float64Array(second.length));
  for (let i = first.length - 1; i >= 0; i -= 1) {
    for (let j = second.length - 1; j >= 0; j -= 1) {
      if (i === first.length - 1 && j === second.length - 1) continue;
      const a = first[i];
      const b = second[j];
      const advanceFirst = first[i + 1] ? cost(a, b, first[i + 1]) + costs[i + 1][j] : Infinity;
      const advanceSecond = second[j + 1] ? cost(a, b, second[j + 1]) + costs[i][j + 1] : Infinity;
      costs[i][j] = Math.min(advanceFirst, advanceSecond);
    }
  }
  let i = 0;
  let j = 0;
  while (i < first.length - 1 || j < second.length - 1) {
    const a = first[i];
    const b = second[j];
    const nextA = first[i + 1];
    const nextB = second[j + 1];
    const advanceFirst = nextA && cost(a, b, nextA) + costs[i + 1][j] <= costs[i][j] + 1e-9;
    const c = advanceFirst ? nextA : nextB;
    emit(a, b, c);
    if (advanceFirst) {
      i += 1;
    } else {
      j += 1;
    }
  }
}

function triangulateShoulder(left, right, surfacePoint) {
  const faces = [];
  triangulateStrip(right, left, surfacePoint, (a, b, c) => faces.push([a, b, c]));
  if (faces.every(([a, b, c]) => projectedArea(a, b, c) > 0)) return faces;

  // A concave rim may need a diagonal between two points on the same side.
  const outline = [...left, ...[...right].reverse()];
  const flat = outline.map(([x, y]) => new Vector2(x, y));
  const triangles = ShapeUtils.triangulateShape(flat, []);
  if (triangles.length !== outline.length - 2) return faces;
  return triangles.map((triangle) => triangle.map((index) => outline[index]));
}

function contourFraction([high, middle, low], y) {
  if (y < middle) return 0.5 * clamp((y - high) / (middle - high), 0, 1);
  return 0.5 + 0.5 * clamp((y - middle) / (low - middle), 0, 1);
}

function sectionContours(start, section, seed) {
  const bridge = bridgeFor(section, start, seed);
  if (!bridge) return { bridge, upper: [], lower: [] };
  const leftIsHigh = bridge.left[0] < bridge.right[0];
  const high = leftIsHigh ? bridge.left : bridge.right;
  const low = leftIsHigh ? bridge.right : bridge.left;
  const upper = [high[0], mix(high[0], low[0], 0.5) - 4, low[0]];
  const lower = [high[1], mix(high[1], low[1], 0.5) + Math.min(2, (low[1] - high[1]) * 0.25), low[1]];
  return { bridge, leftIsHigh, upper, lower };
}

function panelRows(start, end, origin, seed, pitch) {
  // Dense ribs still need enough shared contour for the recessed panels at the seam.
  const apron = Math.max(2, Math.ceil(44 / pitch));
  const first = Math.floor((start - origin) / pitch) - apron;
  const last = Math.ceil((end - origin) / pitch) + apron;
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    return origin + (index + (noise(seed, index ^ 615) - 0.5) * 0.28) * pitch;
  });
}

function resampleRim(panels, anchors, spacing) {
  const rows = [...new Set([...panels, ...anchors.filter((y) => y > panels[0] && y < panels.at(-1))])].sort((a, b) => a - b);
  const samples = [rows[0]];
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    const intervals = Math.max(1, Math.round((b - a) / spacing));
    for (let step = 1; step < intervals; step += 1) samples.push(mix(a, b, step / intervals));
    samples.push(b);
  }
  return samples;
}

function triangleQuality(a, b, c) {
  const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
  const u = c[0] - a[0], v = c[1] - a[1], w = c[2] - a[2];
  const length = Math.max(x * x + y * y + z * z, u * u + v * v + w * w, (x - u) ** 2 + (y - v) ** 2 + (z - w) ** 2);
  return length > 0 ? Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) / length : 0;
}

function narrowInView(a, b, c) {
  const x = b[0] - a[0], y = b[1] - a[1];
  const u = c[0] - a[0], v = c[1] - a[1];
  const length = Math.max(x * x + y * y, u * u + v * v, (x - u) ** 2 + (y - v) ** 2);
  return length > 400 + 1e-8 && Math.abs(x * v - y * u) < length * 0.16 - 1e-8 ? 1 : 0;
}

function triangulateReturnQuad(face, surfacePoint) {
  const [a, b, c, d] = face.map(surfacePoint);
  const firstRays = narrowInView(a, b, c) + narrowInView(a, c, d);
  const secondRays = narrowInView(a, b, d) + narrowInView(b, c, d);
  const first = Math.min(triangleQuality(a, b, c), triangleQuality(a, c, d));
  const second = Math.min(triangleQuality(a, b, d), triangleQuality(b, c, d));
  const [p, q, r, s] = face;
  return firstRays < secondRays || (firstRays === secondRays && first + 1e-9 >= second)
    ? [[p, q, r], [p, r, s]] : [[p, q, s], [q, r, s]];
}

function marginInside(face, point, surfacePoint) {
  const [x, y] = surfacePoint(point);
  let margin = Infinity;
  for (let i = 0; i < face.length; i += 1) {
    const a = surfacePoint(face[i]);
    const b = surfacePoint(face[(i + 1) % face.length]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const side = dx * (y - a[1]) - dy * (x - a[0]);
    if (side <= 0) return 0;
    margin = Math.min(margin, side / Math.hypot(dx, dy));
  }
  return margin;
}

function planeDepth(face, point, surfacePoint) {
  const [x, y] = surfacePoint(point);
  const [a, b, c] = face.map(surfacePoint);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ex = c[0] - a[0];
  const ey = c[1] - a[1];
  const area = dx * ey - dy * ex;
  const u = ((x - a[0]) * ey - (y - a[1]) * ex) / area;
  const v = (dx * (y - a[1]) - dy * (x - a[0])) / area;
  return a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]);
}

function fitMounts(faces, joins, start, width, seed, origin, surfacePoint) {
  for (const mount of joins) {
    const direction = mount.leftBank ? -1 : 1;
    let bestFace = -1;
    let bestPoint;
    let bestMargin = 0.12;
    for (const offset of [0, -1.4, 1.4]) {
      for (const inset of [0, 3, 6, 9]) {
        const x = mount.reach + inset * direction;
        if (x <= mount.x + 0.6 || x >= mount.x + mount.width - 0.6) continue;
        const point = [x, start - meshHeight(x, mount.worldY + offset, width, seed, origin), 2.65];
        for (const [index, face] of faces.entries()) {
          const margin = marginInside(face, point, surfacePoint) - inset * 0.13 - Math.abs(offset) * 0.22;
          if (margin <= bestMargin + 1e-9) continue;
          bestMargin = margin;
          bestPoint = point;
          bestFace = index;
        }
      }
      if (bestMargin >= 1.25) break;
    }
    if (bestFace < 0) continue;
    const face = faces[bestFace];
    if (planeDepth(face, bestPoint, surfacePoint) >= 1.1) continue;
    const pieces = face.map((point, index) => [point, face[(index + 1) % face.length], bestPoint]);
    faces.splice(bestFace, 1, ...pieces);
  }
}

function clipFace(corners, distance) {
  const result = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const from = distance(a);
    const to = distance(b);
    if (from >= 0) result.push(a);
    if (from * to < 0) {
      const t = from / (from - to);
      // A shared binary grid keeps the cut stable after conversion to Float32.
      const point = a.map((value, axis) => Math.round(mix(value, b[axis], t) * SEAM_PRECISION) / SEAM_PRECISION);
      result.push(point);
    }
  }
  return result;
}

export function buildCliffSection(start, end, ledges, worldWidth, settings, seed, section) {
  const origin = start - section * SECTION_HEIGHT;
  const mounts = ledges.map((ledge) => mountingPoint(ledge, worldWidth, settings, seed, origin));
  const contours = sectionContours(start, section, seed);
  const { bridge, leftIsHigh, upper: upperContour, lower: lowerContour } = contours;
  const size = clamp(settings.facetSize ?? 24, 16, 34);
  const stretch = clamp(settings.facetStretch ?? 1.45, 0.9, 1.8);
  const detail = clamp(settings.fractureStrength ?? 0.58, 0, 1);
  const recessScale = clamp(settings.recessDepth ?? 1, 0.6, 1.4);
  const mountSpan = clamp(settings.mountBlend ?? 1, 0.65, 1.4);
  const pitch = Math.min(48, size * stretch);
  const anchors = mounts.flatMap(({ y, capBefore, capAfter }) => capBefore > 0 ? [y - capBefore, y, y + capAfter] : [y]);
  for (let offset = -1; offset <= 1; offset += 1) {
    const bandStart = start + offset * SECTION_HEIGHT;
    const bandContours = offset === 0 ? contours : sectionContours(bandStart, section + offset, seed);
    anchors.push(...bandContours.upper, ...bandContours.lower);
  }
  // A rib shares a nearby mandatory row instead of creating two almost coincident cuts.
  const panels = panelRows(start, end, origin, seed, pitch).map((y) => {
    let closest = y;
    let distance = 4.5;
    for (const anchor of anchors) {
      const offset = Math.abs(anchor - y);
      if (offset >= distance) continue;
      distance = offset;
      closest = anchor;
    }
    return closest;
  });
  const uniqueCuts = resampleRim(panels, anchors, mix(22, 15, detail));
  const indices = new Map(uniqueCuts.map((y, index) => [y, index]));
  const outerLeft = -worldWidth * 0.30;
  const outerRight = worldWidth * 1.30;
  const positions = [];
  const normals = [];
  const vertexIds = new Map();
  const edges = new Map();
  const warped = new Map();
  const strike = seamLean(origin, seed) / worldWidth;
  const surfacePoint = (point) => {
    if (!warped.has(point)) {
      const [x, y, z] = point;
      // An affine strike preserves planar faces as their edges change height.
      warped.set(point, [x, y - strike * (x - worldWidth / 2), z]);
    }
    return warped.get(point);
  };
  const normal = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const frontAspect = { triangles: 0, thin: 0 };
  const frontPanels = new Set();
  const topSlope = seamLean(start, seed) / worldWidth;
  const bottomSlope = seamLean(end, seed) / worldWidth;
  const topDistance = ([x, y]) => -y - (x - worldWidth / 2) * topSlope;
  const bottomDistance = ([x, y]) => y + end - start + (x - worldWidth / 2) * bottomSlope;
  const surface = (face, recessLevel = 0, plane) => {
    const points = face.map(surfacePoint);
    if (points.every((point) => topDistance(point) < 0) || points.every((point) => bottomDistance(point) < 0)) return;
    const [first, second, third] = plane ? plane.map(surfacePoint) : points;
    edgeA.set(second[0] - first[0], second[1] - first[1], second[2] - first[2]);
    edgeB.set(third[0] - first[0], third[1] - first[1], third[2] - first[2]);
    normal.crossVectors(edgeA, edgeB).normalize();
    const planar = points.length === 4 || Boolean(plane);
    if (planar && recessLevel === 0) frontPanels.add(plane ?? face);
    if (!planar && recessLevel === 0 && points.every((point) => topDistance(point) >= 0 && bottomDistance(point) >= 0)) {
      const length = Math.max(edgeA.x ** 2 + edgeA.y ** 2, edgeB.x ** 2 + edgeB.y ** 2, (edgeA.x - edgeB.x) ** 2 + (edgeA.y - edgeB.y) ** 2);
      frontAspect.triangles += 1;
      if (Math.abs(edgeA.x * edgeB.y - edgeA.y * edgeB.x) < length * 0.16) frontAspect.thin += 1;
    }
    let corners = points;
    // Each half keeps the lighting of the original facet crossing the section cut.
    if (points.some((point) => topDistance(point) < 0)) corners = clipFace(corners, topDistance);
    if (points.some((point) => bottomDistance(point) < 0)) corners = clipFace(corners, bottomDistance);
    for (let i = 1; i < corners.length - 1; i += 1) {
      for (const point of [corners[0], corners[i], corners[i + 1]]) {
        positions.push(...point);
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  };
  const frontFace = (face, plane) => {
    surface(face, 0, plane);
    for (const [index, from] of face.entries()) {
      const to = face[(index + 1) % face.length];
      if (!vertexIds.has(from)) vertexIds.set(from, vertexIds.size);
      if (!vertexIds.has(to)) vertexIds.set(to, vertexIds.size);
      const first = vertexIds.get(from);
      const last = vertexIds.get(to);
      if (!edges.delete(`${last}:${first}`)) edges.set(`${first}:${last}`, [from, to]);
    }
  };

  const [leftRim, rightRim] = [true, false].map((isLeft) => {
    const joins = mounts.filter((mount) => mount.leftBank === isLeft);
    const direction = isLeft ? 1 : -1;
    const bank = isLeft ? 0 : 1;
    const outer = isLeft ? outerLeft : outerRight;
    const fixedContact = new Set();
    const rim = uniqueCuts.map((y) => {
      const [left, right] = bankEdges(y, worldWidth, settings, seed, origin, mounts);
      const x = isLeft ? left : right;
      const point = [x, start - y, 0];
      if (joins.some((mount) => {
        const offset = y - mount.y;
        const contact = Math.max(2.5 * mountSpan, offset < 0 ? mount.capBefore : mount.capAfter);
        return Math.abs(offset) <= contact + 1e-8 && Math.abs(x - mount.reach) < 3;
      })) fixedContact.add(point);
      return point;
    });
    const faceStrips = [direction * mix(-0.08, 0.12, noise(seed, bank + 86)), direction * mix(-0.24, -0.09, noise(seed, bank + 244))];
    const shoulderSlope = -direction * mix(0.07, 0.16, noise(seed, bank + 479));
    const ribs = panels.map((y, index) => {
      const first = indices.get(panels[Math.max(0, index - 1)]);
      const last = indices.get(panels[Math.min(panels.length - 1, index + 1)]);
      let width = Infinity;
      for (let i = first; i <= last; i += 1) width = Math.min(width, (rim[i][0] - outer) * direction);
      const t = fracture(y, pitch * 1.4, seed ^ (bank + 976));
      const spine = outer + direction * width * (0.43 + t * 0.29);
      const shoulder = outer + direction * width * (0.78 + t * 0.12);
      const lateral = [(outer - spine) * faceStrips[0], 0, (shoulder - spine) * faceStrips[1]];
      const relief = mix(5, 22, detail) * fracture(y, pitch * 0.85, seed ^ (bank + 720));
      const spineDepth = Math.min(ROCK_RELIEF - Math.max(...lateral), -1.7 + relief);
      return [outer, spine, shoulder].map((x, lane) => [x, start - y, spineDepth + lateral[lane]]);
    });
    const shoulderPlanes = new Map();
    const faces = [];
    for (let index = 1; index < ribs.length; index += 1) {
      const a = ribs[index - 1][2];
      const b = ribs[index][2];
      for (let i = indices.get(panels[index - 1]); i <= indices.get(panels[index]); i += 1) {
        const point = rim[i];
        const t = (point[1] - a[1]) / (b[1] - a[1]);
        point[2] = fixedContact.has(point) ? 2.65 : mix(a[2], b[2], t) + shoulderSlope * (point[0] - mix(a[0], b[0], t));
      }
    }
    for (let index = 1; index < ribs.length; index += 1) {
      const above = ribs[index - 1];
      const below = ribs[index];
      // Across a lane the slope is fixed. Between ribs the spine and its depth
      // interpolate linearly, so all four corners lie on one plane.
      for (let lane = 0; lane < 2; lane += 1) {
        const face = [above[lane], below[lane], below[lane + 1], above[lane + 1]];
        faces.push(isLeft ? face : face.reverse());
      }
      const rimRun = rim.slice(indices.get(panels[index - 1]), indices.get(panels[index]) + 1);
      const guide = [above[2], below[2]];
      const sample = [guide[0][0] + direction * size, guide[0][1], guide[0][2] + shoulderSlope * direction * size];
      const plane = isLeft ? [...guide, sample] : [guide[0], sample, guide[1]];
      for (const face of triangulateShoulder(isLeft ? guide : rimRun, isLeft ? rimRun : guide, surfacePoint)) {
        faces.push(face);
        if (!face.some((point) => fixedContact.has(point))) shoulderPlanes.set(face, plane);
      }
    }
    fitMounts(faces, joins, start, worldWidth, seed, origin, surfacePoint);
    for (const face of faces) frontFace(face, shoulderPlanes.get(face));
    return rim;
  });

  // Stitch the rock between the two open contours into the same front surface.
  if (bridge) {
    let previous = null;
    const first = indices.get(upperContour[0]);
    const last = indices.get(lowerContour[2]);
    for (let index = first; index <= last; index += 1) {
      const y = uniqueCuts[index];
      const lower = contourFraction(lowerContour, y);
      const upper = contourFraction(upperContour, y);
      const [from, to] = leftIsHigh ? [lower, upper] : [1 - upper, 1 - lower];
      const left = leftRim[index];
      const right = rightRim[index];
      const span = (right[0] - left[0]) * (to - from);
      const cells = span > 0 ? Math.max(1, Math.round(span / size)) : 0;
      const row = Array.from({ length: cells + 1 }, (_, column) => {
        const t = cells === 0 || column === 0 ? from : column === cells ? to : mix(from, to, column / cells);
        if (t === 0) return left;
        if (t === 1) return right;
        const x = mix(left[0], right[0], t);
        const fold = 1 - Math.abs(2 * t - 1);
        return [x, start - y, mix(left[2], right[2], t) - fold * 0.65];
      });
      if (previous) triangulateStrip(previous, row, surfacePoint, (a, b, c) => frontFace([a, b, c]));
      previous = row;
    }
  }

  const onOuterEdge = ([x]) => x === outerLeft || x === outerRight;
  const rims = [...edges.values()].filter(([a, b]) => a[1] !== b[1] || (a[1] !== start - panels[0] && a[1] !== start - panels.at(-1)));
  const rimNormals = new Map();
  for (const [a, b] of rims) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    for (const point of [a, b]) {
      const normal = rimNormals.get(point) ?? [0, 0];
      normal[0] += dy / length;
      normal[1] -= dx / length;
      rimNormals.set(point, normal);
    }
  }
  const returns = new Map();
  const bendPhase = noise(seed, 1833) * Math.PI * 2;
  for (const [point, [nx, ny]] of rimNormals) {
    const [x, y, z] = point;
    const length = Math.hypot(nx, ny) || 1;
    const outer = onOuterEdge(point);
    const [outX, outY] = outer ? [0, 0] : [nx / length, ny / length];
    const height = start - y;
    const cut = fracture(height + x * 0.52, 29, seed ^ 591);
    const [left, right] = bankEdges(height, worldWidth, settings, seed, origin, mounts);
    const gap = right - left;
    const targetDepth = worldWidth * (RECESS_DEPTH + cut * RECESS_VARIATION) * recessScale;
    const drop = Math.max(worldWidth * MIN_RETURN_DEPTH, z + targetDepth);
    const bevelInset = Math.min(worldWidth * 0.033, gap * 0.12);
    const foldInset = Math.min(worldWidth * 0.063, gap * 0.24);
    const backInset = Math.min(worldWidth * 0.047, gap * 0.17);
    const bend = outer ? 0 : Math.min(worldWidth * 0.115, gap * 0.19) * mix(0.78, 1.25, detail);
    const turn = 0.79 * Math.sin(height / 58 + bendPhase) + 0.42 * fracture(height, 79, seed ^ 368);
    const foldDepth = mix(0.52, 0.6, detail) + mix(0.04, 0.19, detail)
      * (0.55 * Math.sin(height / 48 + bendPhase) + 0.9 * fracture(height + x * 0.34, 76, seed ^ 817));

    // The same rim vertex is carried through every cross-section of the loft.
    const bevel = [x + outX * bevelInset, y + outY * bevelInset, z - Math.min(drop * 0.25, worldWidth * 0.055 * recessScale)];
    const fold = [x + outX * foldInset + bend * turn, y + outY * foldInset, z - drop * foldDepth];
    const back = [x + outX * backInset + bend * (0.33 * Math.sin(height / 92 - bendPhase) - turn * 0.63), y + outY * backInset, z - drop];
    returns.set(point, [point, bevel, fold, back]);
  }
  for (const [a, b] of rims) {
    const from = returns.get(a);
    const to = returns.get(b);
    const layers = onOuterEdge(a) && onOuterEdge(b) ? [0, 3] : [0, 1, 2, 3];
    for (let i = 1; i < layers.length; i += 1) {
      const front = layers[i - 1];
      const back = layers[i];
      const quad = [to[front], from[front], from[back], to[back]];
      for (const face of triangulateReturnQuad(quad, surfacePoint)) surface(face, i);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, start, end, mounts, bridge, frontAspect: { ...frontAspect, panels: frontPanels.size } };
}

export class ProceduralCliffs {
  constructor(world) {
    this.group = new Group();
    this.group.name = 'Procedural platform cliffs';
    world.add(this.group);
    this.sections = new Map();
    this.mountBands = new Map();
    this.lastBuild = null;
    this.material = new MeshStandardMaterial({ color: ROCK_COLOR, roughness: 0.94 });
  }

  remove(key, section) {
    this.group.remove(section.mesh);
    section.geometry.dispose();
    this.sections.delete(key);
  }

  reset(origin) {
    for (const [key, section] of this.sections) this.remove(key, section);
    this.mountBands.clear();
    this.lastBuild = null;
    this.origin = origin;
  }

  sync(ledges, scrolled, config, worldHeight, seed, force) {
    const bandAt = (y) => Math.floor((y - this.origin) / SECTION_HEIGHT);
    const firstKey = bandAt(scrolled - 24 - SEAM_OFFSET_LIMIT);
    const bands = new Map();
    const add = (key, ledge) => {
      if (key < firstKey - 1) return;
      if (!bands.has(key)) bands.set(key, new Map());
      bands.get(key).set(`${ledge.x},${ledge.y.toFixed(3)},${ledge.width}`, ledge);
    };
    const addLedge = (ledge) => {
      const mount = mountingPoint(ledge, config.world.width, config.platformSupports, seed, this.origin);
      add(bandAt(mount.y), ledge);
    };
    // A recycled ledge can still affect the same facet on both sides of the cut.
    for (const previous of this.mountBands.values()) {
      for (const ledge of previous.values()) {
        if (ledge.y < scrolled) addLedge(ledge);
      }
    }
    let lastLedge = scrolled + worldHeight;
    for (const platform of ledges) {
      const top = Math.round((platform.y + scrolled) * 1000) / 1000;
      const height = platform.height ?? config.platforms.height;
      const y = top + height * 0.54;
      addLedge({ x: platform.x, y, width: platform.width });
      lastLedge = Math.max(lastLedge, y);
    }
    this.mountBands = bands;
    const lastKey = bandAt(Math.max(scrolled + worldHeight + 90, lastLedge + 30));
    for (let key = firstKey; key <= lastKey; key += 1) {
      const current = this.sections.get(key);
      const start = this.origin + key * SECTION_HEIGHT;
      const nearby = [key - 1, key, key + 1].flatMap((neighbor) => [...(bands.get(neighbor) ?? [])]);
      const mountingKeys = new Set(nearby.map(([id]) => id));
      if (current && !force && mountingKeys.size === current.mountingKeys.size && [...mountingKeys].every((id) => current.mountingKeys.has(id))) continue;
      const before = performance.now();
      const rock = buildCliffSection(start, start + SECTION_HEIGHT, nearby.map(([, ledge]) => ledge), config.world.width, config.platformSupports, seed, key);
      const vertices = rock.geometry.getAttribute('position').count;
      this.lastBuild = { ms: performance.now() - before, vertices, triangles: vertices / 3 };
      const mesh = current?.mesh ?? new Mesh(rock.geometry, this.material);
      if (current) {
        mesh.geometry = rock.geometry;
        current.geometry.dispose();
      } else {
        this.group.add(mesh);
      }
      mesh.receiveShadow = true;
      mesh.position.z = -config.platforms.depth / 2;
      this.sections.set(key, { ...rock, mesh, mountingKeys });
    }
  }

  render(scrolled, worldHeight) {
    for (const [key, section] of this.sections) {
      if (section.end < scrolled - 24 - SEAM_OFFSET_LIMIT) {
        this.remove(key, section);
        continue;
      }
      section.mesh.visible = section.start - scrolled < worldHeight + 52 + SEAM_OFFSET_LIMIT;
      section.mesh.position.y = worldHeight + scrolled - section.start;
    }
  }
}
