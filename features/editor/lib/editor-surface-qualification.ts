/**
 * Opts a build into the editor performance qualification harness.
 *
 * Every file session now mounts the Milkdown adapter surface unconditionally:
 * there is no surface selection left to make, and no product-level old/new
 * editor switch. What remains behind this flag is the measurement harness
 * route, which renders inert unless the build sets it, and which is
 * deliberately not a preference, a menu item or anything else a user can
 * reach.
 *
 * The comparison is written against the literal `process.env.NEXT_PUBLIC_*`
 * name so the bundler folds it to a constant and drops the harness entirely
 * from builds that do not set it.
 */
export const MILKDOWN_QUALIFICATION_SURFACE_ENV =
    "NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION";

export function usesMilkdownQualificationSurface(): boolean {
    return process.env.NEXT_PUBLIC_MDX_MILKDOWN_QUALIFICATION === "1";
}
