import { describe, expect, it } from "vitest";
import { parseOsrm, routeKey } from "../road-route";

describe("road route", () => {
  it("reads the first OSRM route", () => {
    const body = { code: "Ok", routes: [{ distance: 812.4, geometry: { type: "LineString", coordinates: [[1.22, 6.13], [1.221, 6.131], [1.223, 6.132]] } }] };
    expect(parseOsrm(body)).toEqual({ coordinates: [[1.22, 6.13], [1.221, 6.131], [1.223, 6.132]], meters: 812 });
  });

  it("is null on an error or a route without a line", () => {
    expect(parseOsrm({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseOsrm({ code: "Ok", routes: [{ geometry: { coordinates: [[1, 2]] } }] })).toBeNull();
    expect(parseOsrm(null)).toBeNull();
  });

  it("rounds positions to about 50 m", () => {
    const a = routeKey({ lat: 6.13191, lng: 1.22281 }, { lat: 6.1365, lng: 1.2163 });
    const b = routeKey({ lat: 6.13199, lng: 1.22289 }, { lat: 6.1365, lng: 1.2163 });
    expect(a).toBe(b);
    expect(a).toBe("1.2230,6.1320;1.2165,6.1365");
  });
});
