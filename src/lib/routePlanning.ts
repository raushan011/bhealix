export type RoutePoint = { id: string; latitude: number; longitude: number };
export type RouteStop = { id: string; distanceFromPreviousKm: number };

export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const earth = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(value));
}

export function nearestNeighborRoute(referenceId: string, points: RoutePoint[]): { stops: RouteStop[]; totalDistanceKm: number } {
  const reference = points.find(point => point.id === referenceId);
  if (!reference) throw new Error("Reference doctor not found among the selected doctors");
  const pool = points.filter(point => point.id !== referenceId);
  const stops: RouteStop[] = [{ id: reference.id, distanceFromPreviousKm: 0 }];
  let current = reference;
  while (pool.length) {
    let bestIndex = 0, bestDistance = Infinity;
    for (let index = 0; index < pool.length; index++) {
      const distance = haversineKm(current, pool[index]);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    const [next] = pool.splice(bestIndex, 1);
    stops.push({ id: next.id, distanceFromPreviousKm: Number(bestDistance.toFixed(2)) });
    current = next;
  }
  const totalDistanceKm = Number(stops.reduce((sum, stop) => sum + stop.distanceFromPreviousKm, 0).toFixed(2));
  return { stops, totalDistanceKm };
}
