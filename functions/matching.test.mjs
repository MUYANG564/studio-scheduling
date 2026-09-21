import test from "node:test";
import assert from "node:assert/strict";
import {
  cityDistanceKm, computeMatches, isWithinBusinessHours, normalizeBusinessHours,
} from "./matching.mjs";

const desired = ["2026-09-25 09:00", "2026-09-25 09:30", "2026-09-25 10:00"];
const studio = (id, city, freeKeys) => ({ id, name: id, city, address: `${city}地址`, freeKeys });
const proximities = [{ city: "北京", nearby_city: "天津", priority: 1 }];

test("business hours default to 08:00-22:00 every day", () => {
  const hours = normalizeBusinessHours();
  assert.equal(isWithinBusinessHours(hours, "2026-09-25", "08:00"), true);
  assert.equal(isWithinBusinessHours(hours, "2026-09-25", "21:30"), true);
  assert.equal(isWithinBusinessHours(hours, "2026-09-25", "22:00"), false);
});

test("closed days and custom daily hours are respected", () => {
  const hours = normalizeBusinessHours();
  hours["5"] = { enabled: true, start: "10:00", end: "18:00" };
  hours["6"] = { enabled: false, start: "10:00", end: "18:00" };
  assert.equal(isWithinBusinessHours(hours, "2026-09-25", "09:30"), false);
  assert.equal(isWithinBusinessHours(hours, "2026-09-25", "10:00"), true);
  assert.equal(isWithinBusinessHours(hours, "2026-09-26", "12:00"), false);
});

test("P0 contains only preferred-city full coverage", () => {
  const result = computeMatches(desired, [
    studio("北京全覆盖棚", "北京", desired),
    studio("上海全覆盖棚", "上海", desired),
  ], { preferredCities: ["北京"], matchMode: "location_first", proximities });
  assert.equal(result.tier, "P0");
  assert.deepEqual(result.p0.map((item) => item.name), ["北京全覆盖棚"]);
  assert.deepEqual(result.p1.map((item) => item.name), ["上海全覆盖棚"]);
});

test("P1 contains nearby and other-city full coverage when P0 is unavailable", () => {
  const result = computeMatches(desired, [
    studio("其他棚", "上海", desired),
    studio("邻近棚", "天津", desired),
    studio("本地部分棚", "北京", desired.slice(0, 2)),
  ], { preferredCities: ["北京"], proximities });
  assert.equal(result.tier, "P1");
  assert.deepEqual(result.p0, []);
  assert.deepEqual(result.p1.map((item) => item.name), ["邻近棚", "其他棚"]);
});

test("no city preference treats every full-cover studio as P0", () => {
  const result = computeMatches(desired, [
    studio("北京棚", "北京", desired),
    studio("上海棚", "上海", desired),
  ], { preferredCities: [], proximities });
  assert.equal(result.tier, "P0");
  assert.equal(result.p0.length, 2);
  assert.deepEqual(result.p1, []);
});

test("schedule-first combination values coverage before location", () => {
  const result = computeMatches(desired, [
    studio("本地一档", "北京", desired.slice(0, 1)),
    studio("外地两档", "上海", desired.slice(0, 2)),
    studio("邻近末档", "天津", desired.slice(2)),
  ], { preferredCities: ["北京"], matchMode: "schedule_first", proximities });
  assert.equal(result.combination.studios[0].name, "外地两档");
  assert.equal(result.combination.coversAll, true);
});

test("location-first combination values preferred and nearby cities first", () => {
  const result = computeMatches(desired, [
    studio("本地一档", "北京", desired.slice(0, 1)),
    studio("外地两档", "上海", desired.slice(0, 2)),
    studio("邻近两档", "天津", desired.slice(1)),
  ], { preferredCities: ["北京"], matchMode: "location_first", proximities });
  assert.deepEqual(result.combination.studios.map((item) => item.name), ["本地一档", "邻近两档"]);
  assert.equal(result.combination.coversAll, true);
});

test("no city preference falls back to schedule-first", () => {
  const result = computeMatches(desired, [
    studio("一档", "北京", desired.slice(0, 1)),
    studio("两档", "上海", desired.slice(0, 2)),
  ], { preferredCities: [], matchMode: "location_first", proximities });
  assert.equal(result.effectiveMode, "schedule_first");
  assert.equal(result.partial[0].name, "两档");
});

test("location-first returns alternative slots on requested dates", () => {
  const extra = "2026-09-25 11:00";
  const result = computeMatches(desired, [
    studio("本地棚", "北京", [desired[0], extra]),
  ], { preferredCities: ["北京"], matchMode: "location_first", proximities });
  assert.equal(result.tier, "P2");
  assert.deepEqual(result.adjustmentOptions[0].available, [extra]);
});

test("P2 location-first sorts unconfigured cities by geographic distance", () => {
  const result = computeMatches(desired, [
    studio("上海棚", "上海", desired.slice(0, 2)),
    studio("天津棚", "天津", desired.slice(0, 1)),
  ], { preferredCities: ["北京"], matchMode: "location_first", proximities: [] });

  assert.equal(result.partial[0].name, "天津棚");
  assert.equal(result.partial[0].location.level, "distance");
  assert.ok(result.partial[0].location.distanceKm < result.partial[1].location.distanceKm);
});

test("manual proximity remains ahead of automatic geographic distance", () => {
  const result = computeMatches(desired, [
    studio("天津棚", "天津", desired.slice(0, 1)),
    studio("上海棚", "上海", desired.slice(0, 1)),
  ], {
    preferredCities: ["北京"],
    matchMode: "location_first",
    proximities: [{ city: "北京", nearby_city: "上海", priority: 1 }],
  });

  assert.equal(result.partial[0].name, "上海棚");
  assert.equal(result.partial[0].location.level, "nearby");
});

test("city coordinate lookup supports Chinese municipality suffixes", () => {
  const result = computeMatches(desired, [
    studio("天津棚", "天津市", desired.slice(0, 1)),
  ], { preferredCities: ["北京市"], matchMode: "location_first", proximities: [] });

  assert.equal(result.partial[0].location.level, "distance");
  assert.ok(result.partial[0].location.distanceKm > 0);
});

test("city suffix variants are treated as the same preferred city", () => {
  const result = computeMatches(desired, [
    studio("北京棚", "北京市", desired),
  ], { preferredCities: ["北京"], matchMode: "location_first", proximities: [] });

  assert.equal(result.tier, "P0");
  assert.equal(result.p0[0].location.level, "preferred");
});

test("Chinese aliases prefer Chinese coordinates when names collide globally", () => {
  const distance = cityDistanceKm("北京", "安顺");

  assert.ok(distance > 1_000 && distance < 2_500);
});

test("manual proximity does not borrow distance from another preferred city", () => {
  const result = computeMatches(desired, [
    studio("上海棚", "上海", desired.slice(0, 1)),
  ], {
    preferredCities: ["不存在的城市", "北京"],
    matchMode: "location_first",
    proximities: [{ city: "不存在的城市", nearby_city: "上海", priority: 1 }],
  });

  assert.equal(result.partial[0].location.level, "nearby");
  assert.equal(result.partial[0].location.nearbyTo, "不存在的城市");
  assert.equal(result.partial[0].location.distanceKm, null);
});
