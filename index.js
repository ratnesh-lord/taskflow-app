// App entry. The background task must be defined before anything else runs,
// because Android may start the JavaScript only to run it (with no screens).
import './src/platform/background';
import 'expo-router/entry';
