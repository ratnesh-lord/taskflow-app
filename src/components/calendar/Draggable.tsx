import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export type DragPoint = { x: number; y: number };

export type DragHandlers = {
  /** The finger has held still long enough and starts moving the item. [grab] is where it holds the item, inside it. */
  onStart: (at: DragPoint, grab: DragPoint) => void;
  onMove: (at: DragPoint) => void;
  onDrop: (at: DragPoint) => void;
  onCancel: () => void;
  /** A tap: the long press did not start. */
  onTap: () => void;
};

/**
 * Makes its child draggable after a long press (350 ms), on a phone and with
 * a mouse, and tappable. A swipe before the long press still scrolls the page.
 * The child must not handle presses itself (a Pressable would take the touch
 * from the drag).
 *
 * The gesture is made once per [enabled]: the screen re-renders while an item
 * is dragged, and a new gesture would cancel the one under the finger. The
 * latest handlers are read through a ref instead.
 */
export function Draggable({ enabled, children, ...handlers }: DragHandlers & { enabled: boolean; children: ReactNode }) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  /* eslint-disable react-hooks/refs -- the gesture's callbacks run on touch events, not during render */
  const gesture = useMemo(() => {
    const tap = Gesture.Tap().runOnJS(true).onEnd((_, success) => {
      if (success) latest.current.onTap();
    });
    const pan = Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(350)
      .runOnJS(true)
      .onStart((e) => latest.current.onStart({ x: e.absoluteX, y: e.absoluteY }, { x: e.x, y: e.y }))
      .onUpdate((e) => latest.current.onMove({ x: e.absoluteX, y: e.absoluteY }))
      .onEnd((e, success) => (success ? latest.current.onDrop({ x: e.absoluteX, y: e.absoluteY }) : latest.current.onCancel()))
      .onFinalize((_, success) => {
        if (!success) latest.current.onCancel();
      });
    return Gesture.Exclusive(pan, tap);
  }, [enabled]);
  /* eslint-enable react-hooks/refs */
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
