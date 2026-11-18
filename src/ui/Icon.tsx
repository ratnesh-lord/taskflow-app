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
  | 'close'
  | 'repeat'
  | 'chevron'
  | 'filter'
  | 'trash'
  | 'link'
  | 'copy'
  | 'calendar'
  | 'tag'
  | 'skip'
  | 'sort'
  | 'undo'
  | 'flag';

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
    case 'repeat':
      return (
        <>
          <Path d="M5 9h13l-3-3" />
          <Path d="M19 15H6l3 3" />
        </>
      );
    case 'chevron':
      return <Path d="M10 6l6 6-6 6" />;
    case 'filter':
      return <Path d="M4 6h16M7 12h10M10 18h4" />;
    case 'trash':
      return (
        <>
          <Path d="M4 7h16M9 7V4h6v3" />
          <Path d="M6 7l1 13h10l1-13" />
        </>
      );
    case 'link':
      return (
        <>
          <Path d="M10 14l4-4" />
          <Path d="M8 11l-3 3 5 5 3-3" />
          <Path d="M16 13l3-3-5-5-3 3" />
        </>
      );
    case 'copy':
      return (
        <>
          <Rect x={8} y={8} width={12} height={12} />
          <Path d="M4 16V4h12" />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect x={4} y={5} width={16} height={15} />
          <Path d="M4 10h16M8 3v4M16 3v4" />
        </>
      );
    case 'tag':
      return (
        <>
          <Path d="M4 4h8l8 8-8 8-8-8z" />
          <Rect x={7.5} y={7.5} width={2} height={2} fill={color} stroke="none" />
        </>
      );
    case 'skip':
      return <Path d="M5 6l7 6-7 6zM14 6l7 6-7 6z" />;
    case 'sort':
      return <Path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />;
    case 'undo':
      return <Path d="M9 5L4 10l5 5M4 10h11a5 5 0 010 10h-3" />;
    case 'flag':
      return <Path d="M5 21V4h12l-2 4 2 4H5" />;
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
