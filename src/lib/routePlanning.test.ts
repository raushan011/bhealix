import { describe,expect,it } from "vitest";
import { haversineKm,nearestNeighborRoute } from "./routePlanning";

describe("route planning",()=>{
  it("computes zero distance for identical coordinates",()=>expect(haversineKm({latitude:28.5,longitude:77.3},{latitude:28.5,longitude:77.3})).toBe(0));

  it("orders stops nearest-first from the reference doctor",()=>{
    const points=[
      {id:"a",latitude:28.50,longitude:77.30},
      {id:"b",latitude:28.90,longitude:77.70},
      {id:"c",latitude:28.52,longitude:77.32},
      {id:"d",latitude:28.60,longitude:77.40}
    ];
    const {stops}=nearestNeighborRoute("a",points);
    expect(stops.map(stop=>stop.id)).toEqual(["a","c","d","b"]);
    expect(stops[0].distanceFromPreviousKm).toBe(0);
  });

  it("rejects a reference id that is not in the selected doctors",()=>{
    expect(()=>nearestNeighborRoute("z",[{id:"a",latitude:0,longitude:0}])).toThrow();
  });
});
