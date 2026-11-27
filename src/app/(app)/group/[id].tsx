import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { compareItems, itemOf } from '@/core/agenda';
import { canManageMembers, canRemove, cleanUsername, isMine, personLabel, USERNAME_HINT } from '@/core/sharing';
import { NameSheet } from '@/components/NameSheet';
import { OptionSheet } from '@/components/OptionSheet';
import { QuickAddButton } from '@/components/QuickAdd';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import type { MemberRecord } from '@/data/snapshot';
import { useData, useGroupCall, useSync } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { EditableText } from '@/ui/EditableText';
import { plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { MenuRow, SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space } from '@/ui/tokens';

type MemberAction = 'admin' | 'member' | 'remove';

const ROLE_WORD = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

/** One group: its tasks, its people, and (for its owner and admins) managing them. */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const call = useGroupCall();
  const router = useRouter();
  const selection = useSelection();
  const [inviting, setInviting] = useState(false);
  const [member, setMember] = useState<MemberRecord | null>(null);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const sync = useSync();

  const group = data.groups.find((g) => g.id === id);
  const items = useMemo(
    () => data.groupTasks.filter((t) => t.groupId === id).map((t) => itemOf(t, data.occurrences.get(t.id) ?? [], now)),
    [data, id, now],
  );

  if (!group) {
    if (sync.phase === 'syncing') {
      return (
        <Screen bottomInset>
          <BackHeader title="Group" />
          <Text variant="small" color="textSecondary">
            Fetching the group…
          </Text>
        </Screen>
      );
    }
    return (
      <Screen bottomInset>
        <BackHeader title="Group" />
        <Text variant="heading">This group is not here</Text>
        <Text variant="small" color="textSecondary">
          You may have left it, been removed, or it was deleted. If you were just invited, accept the invitation under Groups.
        </Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button variant="secondary" label="Go to Groups" onPress={() => router.replace('/groups')} />
        </View>
      </Screen>
    );
  }

  const me = data.me.userId;
  const manage = canManageMembers(group.myRole);
  const open = items.filter((i) => i.open && i.task.status !== 'archived').sort(compareItems);
  const mineOpen = open.filter((i) => isMine(i.task, me));
  const othersOpen = open.filter((i) => !isMine(i.task, me));
  const done = items
    .filter((i) => !i.open)
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
    .slice(0, 30);
  const active = group.members.filter((m) => m.status === 'active');
  const invited = group.members.filter((m) => m.status === 'invited');

  const memberOptions = (m: MemberRecord): { value: MemberAction; label: string; detail?: string }[] => {
    const out: { value: MemberAction; label: string; detail?: string }[] = [];
    if (group.myRole === 'owner' && m.status === 'active' && m.role !== 'owner') {
      out.push(m.role === 'admin'
        ? { value: 'member', label: 'Make an ordinary member', detail: 'Can no longer invite or remove people' }
        : { value: 'admin', label: 'Make an admin', detail: 'Can invite people and remove ordinary members' });
    }
    if (m.memberId !== me && canRemove(group.myRole, m.role)) {
      out.push(m.status === 'invited'
        ? { value: 'remove', label: 'Withdraw the invitation' }
        : { value: 'remove', label: 'Remove from the group', detail: 'Tasks assigned to them go back to whoever created them' });
    }
    return out;
  };

  const act = async (m: MemberRecord, action: MemberAction) => {
    setMember(null);
    const name = personLabel(m);
    if (action === 'remove') {
      await call((g) => g.removeMember(id, m.memberId), m.status === 'invited' ? `Invitation to ${name} withdrawn` : `${name} removed`);
    } else {
      await call((g) => g.setRole(id, m.memberId, action), action === 'admin' ? `${name} is now an admin` : `${name} is now a member`);
    }
  };

  const leaveOrDelete = async (what: 'leave' | 'delete') => {
    if (confirm !== what) {
      setConfirm(what);
      return;
    }
    setConfirm(null);
    const ok = await call((g) => (what === 'leave' ? g.leave(id) : g.deleteGroup(id)), what === 'leave' ? `You left ${group.name}` : `${group.name} deleted`);
    if (ok.ok) router.replace('/groups');
  };

  return (
    <Screen bottomInset bottomSpace={FAB_SPACE} overlay={<QuickAddButton defaults={{ groupId: id }} />}>
      <BackHeader title="Group" />
      {manage ? (
        <EditableText
          key={`name-${id}-${group.name}`}
          accessibilityLabel="Group name"
          value={group.name}
          required
          variant="title"
          maxLength={100}
          onSave={(name) => name.trim() !== group.name && void call((g) => g.rename(id, name.trim()), 'Renamed')}
        />
      ) : (
        <Text variant="title">{group.name}</Text>
      )}
      <Text variant="small" color="textSecondary">
        {`${plural(active.length, 'person', 'people')} · ${plural(open.length, 'open task')}. Everyone here sees the group's tasks, except private ones; only a task's creator and the person it is assigned to can change it.`}
      </Text>

      <TaskList
        lead="date"
        selection={selection}
        sections={[
          { title: 'Assigned to you', items: mineOpen },
          { title: 'Everyone else', items: othersOpen },
          { title: 'Done', items: done },
        ]}
        empty="No tasks yet. Tap + to add one; it is shared with everyone here."
      />

      <View>
        <SectionTitle>{`People · ${active.length}`}</SectionTitle>
        {[...active, ...invited].map((m) => {
          const options = memberOptions(m);
          const role = m.status === 'invited' ? 'Invited, not joined yet' : ROLE_WORD[m.role];
          const label = `${m.memberId === me ? 'You' : personLabel(m)}`;
          return (
            <Pressable
              key={m.id}
              accessibilityRole={options.length ? 'button' : undefined}
              accessibilityLabel={`${label}, ${role}`}
              disabled={!options.length}
              onPress={() => setMember(m)}
              style={({ pressed }) => ({
                minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm,
                borderBottomWidth: 1, borderBottomColor: colors.divider, opacity: pressed ? 0.7 : 1,
              })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" color={m.status === 'invited' ? 'textSecondary' : 'text'} numberOfLines={1}>
                  {label}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {role}
                </Text>
              </View>
              {options.length ? <Icon name="chevron" color={colors.textSecondary} size={16} /> : null}
            </Pressable>
          );
        })}
        {manage ? <MenuRow icon="plus" label="Invite someone by username" onPress={() => setInviting(true)} /> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>Group</SectionTitle>
        {confirm === 'leave' ? (
          <Notice tone="error">Leaving removes the group and its tasks from your devices. Tasks assigned to you go back to whoever created them. Tap Leave again to continue.</Notice>
        ) : null}
        {confirm === 'delete' ? (
          <Notice tone="error">{`Deleting removes ${group.name} and every task in it, for everyone, for good. Tap Delete again to continue.`}</Notice>
        ) : null}
        {group.myRole === 'owner' ? (
          <MenuRow icon="trash" label="Delete group" danger onPress={() => void leaveOrDelete('delete')} />
        ) : (
          <MenuRow icon="back" label="Leave group" danger onPress={() => void leaveOrDelete('leave')} />
        )}
      </View>

      <NameSheet
        visible={inviting}
        title={`Invite to ${group.name}`}
        label="Their username"
        saveLabel="Send invitation"
        plain
        maxLength={21}
        hint={`They see the invitation under More, then Groups, and join when they accept. ${USERNAME_HINT.replace('People find you by it; they never see your email.', '')}`.trim()}
        onClose={() => setInviting(false)}
        onSave={async (text) => {
          const name = cleanUsername(text);
          if (!name) {
            await call(() => Promise.reject(new Error(`“${text}” is not a username. ${USERNAME_HINT}`)));
            return;
          }
          const ok = await call((g) => g.invite(id, name), `Invitation sent to @${name}`);
          if (ok.ok) setInviting(false);
        }}
      />
      <OptionSheet<MemberAction>
        visible={member !== null}
        title={member ? personLabel(member) : ''}
        value={null}
        options={member ? memberOptions(member) : []}
        onClose={() => setMember(null)}
        onPick={(action) => member && void act(member, action)}
      />
    </Screen>
  );
}
