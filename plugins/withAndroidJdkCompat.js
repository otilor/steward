const { withGradleProperties } = require("expo/config-plugins");

/** JDK 24+ treats CMake JNI as a hard error unless native access is enabled. */
module.exports = function withAndroidJdkCompat(config) {
  return withGradleProperties(config, (config) => {
    const key = "org.gradle.jvmargs";
    const value =
      "-Xmx2048m -XX:MaxMetaspaceSize=512m --enable-native-access=ALL-UNNAMED";
    const existing = config.modResults.find((item) => item.key === key);
    if (existing) existing.value = value;
    else config.modResults.push({ type: "property", key, value });
    return config;
  });
};
