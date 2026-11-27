import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { cleanUsername, USERNAME_HINT } from '@/core/sharing';
import { NameSheet } from '@/components/NameSheet';
import { useData, useGroupCall } from '@/state/data';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/** More → Groups: the groups I am in, invitations waiting for me, and a new group. */
export default function Groups() {
  const { data } = useData();
  const call = useGroupCall();
  const router = useRouter();
  const { colors } = useTheme();
  const [sheet, setSheet] = useState<'username' | 'group' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const answer = async (groupId: string, accept: boolean) => {
    setBusy(groupId);
    await call((g) => g.respond(groupId, accept), accept ? 'Joined. Its tasks arrive in a moment.' : 'Invitation declined');
    setBusy(null);
  };

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Groups" subtitle={data.groups.length ? plural(data.groups.length, 'group') : undefined} />

      {data.me.username ? (
        <Text variant="small" color="textSecondary">
          {`You are @${data.me.username}. People invite you by that name.`}
        </Text>
      ) : (
        <View style={{ gap: space.sm }}>
          <Notice>Choose a username first. People invite you to groups by it; they never see your email address.</Notice>
          <View style={{ alignItems: 'flex-start' }}>
            <Button label="Choose a username" onPress={() => setSheet('username')} />
          </View>
        </View>
      )}

      {data.invites.length ? (
        <View>
          <SectionTitle>{`Invitations · ${data.invites.length}`}</SectionTitle>
          {data.invites.map((inv) => (
            <View key={inv.groupId} style={{ paddingVertical: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <Text variant="bodyStrong">{inv.groupName}</Text>
              <Text variant="caption" color="textSecondary">
                {inv.invitedBy ? `${inv.invitedBy} invited you` : 'You are invited'}
              </Text>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Button label="Join" busy={busy === inv.groupId} busyLabel="Joining…" onPress={() => void answer(inv.groupId, true)} />
                <Button variant="secondary" label="Decline" disabled={busy === inv.groupId} onPress={() => void answer(inv.groupId, false)} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <SectionTitle>Your groups</SectionTitle>
        {data.groups.length === 0 ? (
          <Text variant="small" color="textSecondary">
            A group is a few people sharing tasks: a household, a team, a club. Everyone in it sees its tasks, a task can be assigned to anyone in it, and a task can be made private to the person who made it and the person who has it.
          </Text>
        ) : (
          data.groups.map((g) => {
            const open = data.groupTasks.filter((t) => t.groupId === g.id && t.status !== 'completed' && t.status !== 'archived').length;
            const people = g.members.filter((m) => m.status === 'active').length;
            return (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                accessibilityLabel={`${g.name}, ${plural(people, 'person', 'people')}, ${plural(open, 'open task')}`}
                onPress={() => router.push(`/group/${g.id}`)}
                style={({ pressed }) => ({
                  paddingVertical: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md,
                  borderBottomWidth: 1, borderBottomColor: colors.divider, opacity: pressed ? 0.7 : 1,
                })}>
                <Icon name="people" color={colors.text} size={20} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {`${plural(people, 'person', 'people')} · ${plural(open, 'open task')}${g.myRole === 'owner' ? ' · you own it' : g.myRole === 'admin' ? ' · you are an admin' : ''}`}
                  </Text>
                </View>
                <Icon name="chevron" color={colors.textSecondary} size={16} />
              </Pressable>
            );
          })
        )}
      </View>

      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="New group" disabled={!data.me.username} onPress={() => setSheet('group')} />
      </View>
      <Text variant="caption" color="textSecondary">
        Creating, joining and changing groups needs a connection. Group tasks then work offline like your own.
      </Text>

      <NameSheet
        visible={sheet === 'username'}
        title="Your username"
        label="Username"
        saveLabel="Save username"
        plain
        maxLength={21}
        hint={USERNAME_HINT}
        onClose={() => setSheet(null)}
        onSave={async (text) => {
          const name = cleanUsername(text);
          if (!name) {
            await call(() => Promise.reject(new Error(`“${text}” cannot be a username. ${USERNAME_HINT}`)));
            return;
          }
          const saved = await call((g) => g.claimUsername(name), `You are now @${name}`);
          if (saved.ok) setSheet(null);
        }}
      />
      <NameSheet
        visible={sheet === 'group'}
        title="New group"
        label="Group name"
        saveLabel="Create group"
        hint="You will own it: you invite people and can make them admins."
        onClose={() => setSheet(null)}
        onSave={async (name) => {
          const created = await call((g) => g.createGroup(name), `Created ${name}`);
          setSheet(null);
          if (created.ok) router.push(`/group/${created.value}`);
        }}
      />
    </Screen>
  );
}
