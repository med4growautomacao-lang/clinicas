-- Single policy differentiating org_owner from org_admin over org membership.
--
-- org_owner: full access to every org_users row of the organization.
-- org_admin: same management power as owner EXCEPT it may not touch the org_owner
--            role in any way:
--              * cannot create an owner (INSERT with role = 'org_owner')
--              * cannot promote anyone to owner (UPDATE role -> 'org_owner')
--              * cannot delete an owner (DELETE of a row whose role = 'org_owner')
--              * cannot demote/edit an existing owner (UPDATE of an owner row)
--            i.e. org_admin only operates on rows where role <> 'org_owner'.
-- super-admin: unaffected, granted by the separate "Super admins can manage all
--              org users" policy (permissive OR).
--
-- Background: 20260522000001 made can_manage_org() accept org_owner + org_admin,
-- but this table's management was still gated on is_org_owner() (owner only),
-- which is why an org_admin could not delete a clinic / manage members.
-- The same expression is used in USING and WITH CHECK: USING guards the existing
-- row (UPDATE/DELETE), WITH CHECK guards the new row (INSERT/UPDATE).

DROP POLICY IF EXISTS "org_users_manage_policy" ON public.org_users;

CREATE POLICY "org_users_manage_policy" ON public.org_users
  FOR ALL
  USING (
    public.can_manage_org(organization_id)
    AND (public.is_org_owner(organization_id) OR role <> 'org_owner')
  )
  WITH CHECK (
    public.can_manage_org(organization_id)
    AND (public.is_org_owner(organization_id) OR role <> 'org_owner')
  );
