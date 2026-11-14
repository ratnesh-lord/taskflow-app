import { View } from 'react-native';

import { useTheme } from '@/state/theme';

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.divider }} />;
}
