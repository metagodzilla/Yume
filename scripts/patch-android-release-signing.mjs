// Points the release build at android/keystore.properties.
// Safe to run after every `expo prebuild`. No-op once the file is already patched.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gradlePath = join(process.cwd(), 'android', 'app', 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');

if (!gradle.includes('keystorePropertiesFile')) {
  const loader = `
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;
  gradle = gradle.replace('\nandroid {', `\n${loader}android {`);
}

if (!gradle.includes("storeFile file(keystoreProperties['storeFile'])")) {
  gradle = gradle.replace(
    'signingConfigs {\n        debug {',
    `signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
        debug {`,
  );
}

gradle = gradle.replace(
  `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`,
  `        release {
            signingConfig signingConfigs.release`,
);

writeFileSync(gradlePath, gradle);

const propsPath = join(process.cwd(), 'android', 'gradle.properties');
let props = readFileSync(propsPath, 'utf8');
props = props.replace(
  'android.enableMinifyInReleaseBuilds=true',
  'android.enableMinifyInReleaseBuilds=false',
);
if (!props.includes('org.gradle.workers.max')) {
  props += '\norg.gradle.workers.max=2\n';
}
writeFileSync(propsPath, props);
console.log('Release signing is wired to android/keystore.properties');
