/**
 * Usernames and groups: the server functions that change them
 * (supabase/migrations/20261128000100_groups.sql). These run online only;
 * the changes then reach this device, and the other members', by syncing.
 *
 * The call itself is passed in (`rpc`), so tests can run these against a
 * real Postgres exactly as the app runs them against Supabase.
 */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type FoundUser = { username: string; name: string };

export class GroupService {
  constructor(private readonly rpc: Rpc) {}

  /** Set or change my username; returns it as stored (lower case). */
  async claimUsername(username: string): Promise<string> {
    return String(await this.rpc('claim_username', { p_username: username }));
  }

  /** Exactly this username, or null. Shows only username and name. */
  async findUser(username: string): Promise<FoundUser | null> {
    const found = (await this.rpc('find_user', { p_username: username })) as FoundUser | null;
    return found && typeof found === 'object' && typeof found.username === 'string' ? found : null;
  }

  /** A new group with me as its owner; returns its id. */
  async createGroup(name: string): Promise<string> {
    return String(await this.rpc('create_group', { p_name: name }));
  }

  async invite(groupId: string, username: string): Promise<void> {
    await this.rpc('invite_to_group', { p_group: groupId, p_username: username });
  }

  async respond(groupId: string, accept: boolean): Promise<void> {
    await this.rpc('respond_to_invite', { p_group: groupId, p_accept: accept });
  }

  /** Remove a member, or withdraw an invitation. */
  async removeMember(groupId: string, memberId: string): Promise<void> {
    await this.rpc('remove_member', { p_group: groupId, p_member: memberId });
  }

  async leave(groupId: string): Promise<void> {
    await this.rpc('leave_group', { p_group: groupId });
  }

  async setRole(groupId: string, memberId: string, role: 'admin' | 'member'): Promise<void> {
    await this.rpc('set_member_role', { p_group: groupId, p_member: memberId, p_role: role });
  }

  async rename(groupId: string, name: string): Promise<void> {
    await this.rpc('rename_group', { p_group: groupId, p_name: name });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.rpc('delete_group', { p_group: groupId });
  }
}
