function parseObj(text) {
  const vertices = [];
  const triangles = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === "v" && fields.length >= 4) {
      const vertex = fields.slice(1, 4).map(Number);
      if (vertex.some((value) => !Number.isFinite(value))) throw new Error("OBJ contains an invalid vertex.");
      vertices.push(vertex);
    } else if (fields[0] === "f" && fields.length >= 4) {
      const indices = fields.slice(1).map((part) => Number(part.split("/")[0]));
      const resolved = indices.map((index) => index < 0 ? vertices.length + index : index - 1);
      if (resolved.some((index) => index < 0 || index >= vertices.length)) throw new Error("OBJ face refers to a missing vertex.");
      for (let index = 1; index < resolved.length - 1; index += 1) triangles.push([resolved[0], resolved[index], resolved[index + 1]]);
    }
  }
  if (!vertices.length || !triangles.length) throw new Error("OBJ has no triangulatable mesh.");
  return { vertices, triangles };
}

function parseStl(buffer) {
  const binaryCount = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0;
  if (binaryCount > 0 && 84 + binaryCount * 50 === buffer.length) {
    const vertices = [];
    const triangles = [];
    for (let face = 0; face < binaryCount; face += 1) {
      const start = 84 + face * 50 + 12;
      const offset = vertices.length;
      for (let point = 0; point < 3; point += 1) {
        const at = start + point * 12;
        vertices.push([buffer.readFloatLE(at), buffer.readFloatLE(at + 4), buffer.readFloatLE(at + 8)]);
      }
      triangles.push([offset, offset + 1, offset + 2]);
    }
    return { vertices, triangles };
  }

  const text = buffer.toString("ascii");
  if (!/^\s*solid\b/i.test(text)) throw new Error("STL is not a valid ASCII or binary mesh.");
  const vertices = [...text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi)]
    .map((match) => match.slice(1, 4).map(Number));
  if (!vertices.length || vertices.length % 3 !== 0 || vertices.some((v) => v.some((x) => !Number.isFinite(x)))) {
    throw new Error("STL contains no valid triangle mesh.");
  }
  const triangles = [];
  for (let i = 0; i < vertices.length; i += 3) triangles.push([i, i + 1, i + 2]);
  return { vertices, triangles };
}

function summarizeMesh(mesh, asset) {
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const point of mesh.vertices) point.forEach((value, axis) => {
    mins[axis] = Math.min(mins[axis], value);
    maxs[axis] = Math.max(maxs[axis], value);
  });
  const edgeCounts = new Map();
  const edgeDirections = new Map();
  const pointKey = (index) => mesh.vertices[index].join(",");
  const edgeKey = (a, b) => [pointKey(a), pointKey(b)].sort().join("|");
  const areaAndSignedVolume = mesh.triangles.reduce((result, [a, b, c]) => {
    const p = mesh.vertices[a], q = mesh.vertices[b], r = mesh.vertices[c];
    const u = q.map((x, i) => x - p[i]), v = r.map((x, i) => x - p[i]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    result.area += Math.hypot(...cross) / 2;
    result.volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    for (const [first, second] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(first, second);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      const directions = edgeDirections.get(key) ?? { forward: 0, reverse: 0 };
      if (pointKey(first) <= pointKey(second)) directions.forward += 1;
      else directions.reverse += 1;
      edgeDirections.set(key, directions);
    }
    return result;
  }, { area: 0, volume: 0 });
  const watertight = edgeCounts.size > 0 && [...edgeCounts.values()].every((count) => count === 2)
    && [...edgeDirections.values()].every(({ forward, reverse }) => forward === 1 && reverse === 1);
  return {
    geometryId: asset.assetId,
    assetId: asset.assetId,
    status: "extracted",
    units: "source_units_unknown",
    dimensions: { x: maxs[0] - mins[0], y: maxs[1] - mins[1], z: maxs[2] - mins[2] },
    volume: watertight ? Math.abs(areaAndSignedVolume.volume) : null,
    surfaceArea: areaAndSignedVolume.area,
    triangleCount: mesh.triangles.length,
    watertight,
    classification: { shapeClass: null, partFamily: null, rotationalSymmetry: null, status: "unavailable" },
    features: [],
    featureDetectionStatus: "unavailable",
    shapeFingerprint: { planarRatio: null, curvedSurfaceRatio: null, boundingBoxFill: null, criticalPoints: [], embedding: [] },
    source: { type: "geometry_asset", assetId: asset.assetId, filename: asset.filename },
    confidence: 0.99,
    notice: watertight ? "Mesh measurements use the file's coordinate units. Units, feature recognition, and shape classification were not inferred." : "Mesh measurements use the file's coordinate units. Volume is unavailable because the mesh is not watertight; units, feature recognition, and shape classification were not inferred.",
  };
}

export async function extractGeometry(asset, storage) {
  const extension = asset.filename.slice(asset.filename.lastIndexOf(".")).toLowerCase();
  if (![".stl", ".obj"].includes(extension)) {
    return { assetId: asset.assetId, status: "unavailable", reason: `No geometry parser is configured for ${extension}.`, features: [], featureDetectionStatus: "unavailable" };
  }
  const bytes = await storage.get(asset.storageKey);
  const mesh = extension === ".obj" ? parseObj(bytes.toString("utf8")) : parseStl(bytes);
  return summarizeMesh(mesh, asset);
}

export function parseObjBuffer(buffer) {
  return parseObj(buffer.toString("utf8"));
}
