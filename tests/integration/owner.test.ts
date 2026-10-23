import { describe, expect, it } from 'vitest';
import { adminClient, signedInUser } from './helpers';

/**
 * Owner bootstrap through the trusted path. Uses p_replace so the test works
 * whether or not an owner already exists, then restores the previous owner.
 */
describe('single-owner model', () => {
  it('grants owner access only through the service-role function', async () => {
    const admin = adminClient();
    const previous = await admin.rpc('admin_assign_owner', { p_email: '__probe_does_not_exist__@example.test' });
    expect(previous.error?.code).toBe('P0002');

    const u = await signedInUser('owner');
    expect(await u.services.access.getMyAccess()).toMatchObject({ isOwner: false });

    const { data: currentOwner } = await admin.from('audit_events').select('resource_id').eq('event_type', 'owner.assigned').order('created_at', { ascending: false }).limit(1);

    const assigned = await admin.rpc('admin_assign_owner', { p_email: u.email, p_replace: true });
    expect(assigned.error).toBeNull();
    expect(await u.services.access.getMyAccess()).toEqual({ isOwner: true, ownerConfigured: true });

    // The owner may review everyone's audit events; other data stays private.
    const other = await signedInUser('owner-other');
    const { data: otherEvents } = await u.client.from('audit_events').select('id').eq('actor_user_id', other.id);
    expect(otherEvents?.length).toBeGreaterThan(0);
    expect(await u.services.settings.get(other.id)).toBeNull();

    // Restore whoever owned the deployment before this test, if anyone.
    const prevId = currentOwner?.[0]?.resource_id;
    if (prevId) {
      const { data } = await admin.auth.admin.getUserById(prevId);
      if (data.user?.email) await admin.rpc('admin_assign_owner', { p_email: data.user.email, p_replace: true });
    }
  });
});
