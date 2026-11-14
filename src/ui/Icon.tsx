import type { ReactNode } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * Line icons drawn with straight segments and square ends, to match the
 * square-cornered interface. 24 x 24 grid, 1.75 stroke.
 */
export type IconName =
  | 'today'
  | 'inbox'
  | 'upcoming'
  | 'projects'
  | 'more'
  | 'search'
  | 'plus'
  | 'check'
  | 'back'
  | 'bell'
  | 'close';

function shapes(name: IconName, color: string): ReactNode {
  switch (name) {
    case 'today':
      return (
        <>
          <Rect x={4} y={5} width={16} height={15} />
          <Path d="M4 10h16" />
          <Rect x={10} y={13} width={4} height={4} fill={color} stroke="none" />
        </>
      );
    case 'inbox':
      return (
        <>
          <Path d="M4 13v6h16v-6" />
          <Path d="M4 13l3-8h10l3 8" />
          <Path d="M4 13h5v3h6v-3h5" />
        </>
      );
    case 'upcoming':
      return (
        <>
          <Rect x={4} y={5} width={16} height={15} />
          <Path d="M4 10h16M8 3v4M16 3v4" />
        </>
      );
    case 'projects':
      return <Path d="M3 6h7l2 3h9v10H3z" />;
    case 'more':
      return (
        <>
          <Rect x={4} y={10.5} width={3} height={3} fill={color} stroke="none" />
          <Rect x={10.5} y={10.5} width={3} height={3} fill={color} stroke="none" />
          <Rect x={17} y={10.5} width={3} height={3} fill={color} stroke="none" />
        </>
      );
    case 'search':
      return (
        <>
          <Rect x={4} y={4} width={11} height={11} />
          <Path d="M15 15l5 5" />
        </>
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" />;
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7" />;
    case 'back':
      return <Path d="M14 5l-7 7 7 7" />;
    case 'bell':
      return (
        <>
          <Path d="M6 17V10l3-4h6l3 4v7" />
          <Path d="M4 17h16" />
          <Path d="M10 20h4" />
        </>
      );
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" />;
  }
}

export function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter">
      {shapes(name, color)}
    </Svg>
  );
}
