// @ts-check
/** @type {import("@babel/core").ConfigFunction} */
module.exports = function (api) {
  // `api.cache(true)` and `api.cache.forever()` are documented as equivalent
  // shorthand (https://babeljs.io/docs/config-files#apicache) — permacache the
  // computed config and never re-invoke this function. `@types/babel__core`
  // deliberately does not type the boolean call-signature shorthand (its own
  // comment calls it "undocumented" from Babel's own type-generation
  // standpoint), so `.forever()` is the one of the two forms that type-checks.
  api.cache.forever();
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin drives Reanimated 4 (plan.md §10.5:
    // "platform-native implementations ... Reanimated on Android"). It
    // must be listed last.
    plugins: ["react-native-worklets/plugin"],
  };
};
