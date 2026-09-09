// T317: resolve the `--device` profile an Android emulator AVD is created
// with against the runner's REAL device catalog, instead of hardcoding a
// name the catalog may not have.
//
// ## The defect this exists for
//
// `.github/workflows/android-maestro-e2e.yml` passed `profile: pixel_8` to
// `reactivecircus/android-emulator-runner` in both of its emulator jobs.
// On Maestro run 34392173679 — the first dispatch that ever got an APK as
// far as an emulator, after T310/T311/T314/T315/T316 cleared everything in
// front of it — all five shards died 35 seconds in, at AVD creation:
//
//   [command]avdmanager create avd --force -n test \
//     --package 'system-images;android-35;default;x86_64' --device 'pixel_8'
//   Error: No device found matching --device pixel_8.
//
// `avdmanager`'s device catalog is fixed by whichever `cmdline-tools`
// version is preinstalled on the runner image, and `pixel_8` is not in it.
// Nothing in this repository could have known that statically: the catalog
// is a property of a GitHub runner image, not of any committed file, and it
// changes when GitHub bumps that image.
//
// ## Why this resolves at run time rather than being a guard
//
// Every other check in this directory answers a question a committed file
// can answer. This one cannot: no static analysis can tell you which device
// definitions the runner will ship next month. So the workflow asks the
// catalog itself, picks the first preference it actually has, and — when it
// has none of them — falls back to no `--device` flag at all, which is
// `android-emulator-runner`'s own default and always valid. The failure
// mode this closes is not "we chose wrong", it is "a runner image change
// silently makes the choice invalid".
//
// `plan.md` §14's performance budget names "a Pixel 8 API 35 reference
// emulator", so `pixel_8` stays FIRST in the preference list below and is
// used whenever the catalog has it. The fallbacks exist so a catalog that
// does not have it costs a warning in the log rather than five red jobs.
//
// Pure, dependency-free functions only; `run-resolve-avd-device-profile.mjs`
// is the CLI entry point that runs `avdmanager` and writes the chosen
// profile to `$GITHUB_OUTPUT`.

/**
 * Device profile ids to use, best first. `pixel_8` leads because `plan.md`
 * names a Pixel 8 API 35 emulator as this project's reference device; the
 * rest are progressively older Pixel definitions, any of which is a closer
 * match to that reference than the emulator's own default skin.
 */
export const PREFERRED_AVD_DEVICE_PROFILES = [
  "pixel_8",
  "pixel_7",
  "pixel_6",
  "pixel_5",
  "pixel_4",
];

// `avdmanager list device` prints one `id: <n> or "<id>"` line per device,
// followed by indented Name/OEM lines and a `---------` separator. Some ids
// contain spaces (`"Galaxy Nexus"`), so the quoted form is the only
// reliable thing to read.
const DEVICE_ID_LINE_PATTERN = /^\s*id:\s*\d+\s+or\s+"([^"]+)"\s*$/;

/**
 * @param {string} listOutput raw stdout of `avdmanager list device`
 * @returns {string[]} every device profile id the catalog offers, in the
 *   order it lists them
 */
export function parseAvdDeviceIds(listOutput) {
  const ids = [];
  for (const line of listOutput.split("\n")) {
    const match = line.match(DEVICE_ID_LINE_PATTERN);
    if (match) ids.push(match[1]);
  }
  return ids;
}

/**
 * @param {string[]} availableIds output of `parseAvdDeviceIds`
 * @param {string[]} [preferences]
 * @returns {string} the best available profile id, or `""` meaning "pass no
 *   `--device` flag" — which `reactivecircus/android-emulator-runner` treats
 *   as its documented default rather than as an error, so an empty result is
 *   a working configuration and never a failure
 */
export function chooseAvdDeviceProfile(availableIds, preferences = PREFERRED_AVD_DEVICE_PROFILES) {
  const available = new Set(availableIds);
  return preferences.find((profile) => available.has(profile)) ?? "";
}
