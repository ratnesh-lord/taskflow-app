import { useRouter } from 'expo-router';

import { IconButton } from '@/ui/IconButton';

/** Search and the full, filterable task list, reachable from every main screen. */
export function HeaderTools() {
  const router = useRouter();
  return (
    <>
      <IconButton icon="search" label="Search tasks" onPress={() => router.push('/search')} />
      <IconButton icon="filter" label="All tasks and filters" onPress={() => router.push('/all-tasks')} />
    </>
  );
}
