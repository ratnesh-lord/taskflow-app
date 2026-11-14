// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const SQUARE_CORNERS = 'TaskFlow uses square corners everywhere: border radius is not allowed.';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'supabase/functions/*'],
  },
  {
    rules: {
      // The design system has no rounded corners. This fails the build on
      // borderRadius, borderTopLeftRadius and the rest, in style objects and props.
      'no-restricted-syntax': [
        'error',
        { selector: "Property[key.name=/^border.*Radius$/]", message: SQUARE_CORNERS },
        { selector: "Property[key.value=/^border.*Radius$/]", message: SQUARE_CORNERS },
        { selector: "JSXAttribute[name.name=/^border.*Radius$/]", message: SQUARE_CORNERS },
      ],
    },
  },
]);
