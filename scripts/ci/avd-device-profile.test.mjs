import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chooseAvdDeviceProfile,
  parseAvdDeviceIds,
  PREFERRED_AVD_DEVICE_PROFILES,
} from "./avd-device-profile.mjs";

// Real `avdmanager list device` shape, including the two properties that
// break a naive parser: an id containing a space, and indented Name/OEM
// lines that also contain the word "id".
const LIST_OUTPUT = `Available devices definitions:
id: 0 or "automotive_1024p_landscape"
    Name: Automotive (1024p landscape)
    OEM : Google
---------
id: 1 or "Galaxy Nexus"
    Name: Galaxy Nexus
    OEM : Google
---------
id: 2 or "pixel_6"
    Name: Pixel 6
    OEM : Google
---------
id: 3 or "pixel_7"
    Name: Pixel 7
    OEM : Google
---------
`;

test("parseAvdDeviceIds reads the quoted id of every device", () => {
  assert.deepEqual(parseAvdDeviceIds(LIST_OUTPUT), [
    "automotive_1024p_landscape",
    "Galaxy Nexus",
    "pixel_6",
    "pixel_7",
  ]);
});

test("parseAvdDeviceIds ignores prose, headers and separators", () => {
  assert.deepEqual(parseAvdDeviceIds("Available devices definitions:\n---------\n"), []);
  assert.deepEqual(parseAvdDeviceIds(""), []);
  // A Name line mentioning an id-like string is not a device id.
  assert.deepEqual(parseAvdDeviceIds('    Name: id: 9 or "nope"\n'), []);
});

test("the best AVAILABLE preference wins, not the first preference overall", () => {
  // The whole point: pixel_8 leads the preference list (plan.md's reference
  // device) but this catalog does not have it, which is exactly what turned
  // all five shards of run 34392173679 red.
  assert.equal(chooseAvdDeviceProfile(parseAvdDeviceIds(LIST_OUTPUT)), "pixel_7");
});

test("pixel_8 is used whenever the catalog does have it", () => {
  assert.equal(chooseAvdDeviceProfile(["pixel_6", "pixel_8", "pixel_7"]), "pixel_8");
  assert.equal(PREFERRED_AVD_DEVICE_PROFILES[0], "pixel_8", "plan.md's reference device leads");
});

test("no preferred profile yields an empty string, never a throw", () => {
  // An empty `profile` input makes reactivecircus/android-emulator-runner
  // omit `--device` entirely, which is its documented default and always a
  // valid AVD — so "none of them" is a working configuration, not a failure.
  assert.equal(chooseAvdDeviceProfile(["Galaxy Nexus", "tv_1080p"]), "");
  assert.equal(chooseAvdDeviceProfile([]), "");
});

test("both emulator jobs consume the resolver's output, and neither hardcodes a profile", () => {
  // The mistake this replaces was a literal `profile: pixel_8` in two
  // places; a fix applied to only one of them would look done and leave the
  // other red on the next dispatch.
  const workflow = readFileSync(".github/workflows/android-maestro-e2e.yml", "utf8");

  const consumers = workflow.match(/profile: \$\{\{ steps\.avd\.outputs\.profile \}\}/g) ?? [];
  assert.equal(consumers.length, 2, "both emulator steps must read the resolved profile");

  const resolvers = workflow.match(/run-resolve-avd-device-profile\.mjs/g) ?? [];
  assert.equal(resolvers.length, 2, "each emulator step needs its own resolver step");

  assert.equal(
    /^\s+profile: (?!\$\{\{)/m.test(workflow),
    false,
    "no emulator step may hardcode a device profile again",
  );
});
