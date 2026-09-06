module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-worklets/plugin drives Reanimated 4 (plan.md §10.5:
    // "platform-native implementations ... Reanimated on Android"). It
    // must be listed last.
    plugins: ["react-native-worklets/plugin"],
  };
};
