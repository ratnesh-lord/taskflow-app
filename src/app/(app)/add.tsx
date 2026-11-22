import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useQuickAdd } from '@/components/QuickAdd';

/**
 * taskflow://add, opened by + on the Today's tasks widget: Today with the
 * quick-add sheet open.
 */
export default function AddFromWidget() {
  const open = useQuickAdd();
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
    open();
  }, [open, router]);
  return null;
}
