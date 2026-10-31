import { mutateCanonical } from '../app/slash/canonicalSessionControls.js'
import type { GatewayClient } from '../gatewayClient.js'
import { asRpcResult, rpcErrorMessage } from '../lib/rpc.js'
import type { ProjectInfo } from '../types.js'

/** Project helpers shared by `/projects` and the interactive picker.
 *
 *  The TUI resolves Projects itself (per-profile `projects.db`, the desktop sidebar's named
 *  workspaces) because the slash worker is a shadow process: it can list the DB but cannot move
 *  the LIVE session's workspace. Resolution order mirrors `tools/project_tools.py::_resolve`. */

/** The folder a project opens into: `primary_path`, else the folder flagged primary, else the
 *  first one recorded. */
export const projectPath = (project: ProjectInfo): string =>
  project.primary_path || project.folders?.find(folder => folder.is_primary)?.path || project.folders?.[0]?.path || ''

/** Exact id/slug/name first, then case-insensitive slug/name. */
export const findProject = (projects: ProjectInfo[], token: string): ProjectInfo | undefined => {
  const needle = token.trim()

  if (!needle) {
    return undefined
  }

  const exact = projects.find(project => project.id === needle || project.slug === needle || project.name === needle)

  if (exact) {
    return exact
  }

  const lower = needle.toLowerCase()

  return projects.find(project => project.slug.toLowerCase() === lower || project.name.toLowerCase() === lower)
}

/** True when *cwd* is the project's folder or below it. */
export const holds = (path: string, cwd: string) =>
  Boolean(path) && Boolean(cwd) && (cwd === path || cwd.startsWith(path.replace(/[\\/]+$/, '') + '/'))

/** One line per project: `●` the active selection, `← here` the folder this session is in. */
export const projectLines = (projects: ProjectInfo[], activeId: null | string | undefined, cwd: string): string[] => {
  const width = Math.min(24, Math.max(4, ...projects.map(project => project.name.length)))

  return projects.map(project => {
    const path = projectPath(project)
    const marker = project.id === activeId ? '●' : ' '

    return `${marker} ${project.name.padEnd(width)}  ${path || '(no folder)'}${holds(path, cwd) ? '   ← here' : ''}`
  })
}

export interface ProjectRow {
  active: boolean
  here: boolean
  path: string
  project: ProjectInfo
}

/** Rows for the picker, active first, then the folder this session already sits in. */
export const projectRows = (projects: ProjectInfo[], activeId: null | string | undefined, cwd: string): ProjectRow[] =>
  projects
    .map(project => {
      const path = projectPath(project)

      return { active: project.id === activeId, here: holds(path, cwd), path, project }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.here) - Number(a.here))

interface SessionsCwdResponse {
  cwd?: string
}

/** The wire text of a failed RPC. `rpcErrorMessage` REPLACES it with copy aimed at the user, so a
 *  dispatch failure ("unknown method: …") must be recognised before that translation, or every
 *  missing-verb refusal reads as a generic backend complaint. */
const wireText = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : ''

const missingVerb = (text: string) => /unknown method|not implemented/i.test(text)

/** Point the sidebar's selection at *project* and move the live session into its folder.
 *
 *  Three backends answer this, in descending order of strength:
 *  `session.workspace.move` re-homes the stored row AND a live agent (even mid-turn) by the durable
 *  session key; `session.cwd.set` is the older by-session-id verb, local-only as well; a
 *  shared/canonical owner (`hermes-gateway-v1`) serves NEITHER and keeps the workspace behind the
 *  revision-fenced `session.mutate` operation `workspace` (`gateway/session_mutations.py`). Try each
 *  in turn and never report a move that did not happen. Resolves to the folder the backend reports;
 *  rejects with a human-readable Error naming the refusal that mattered. */
export async function moveSessionInto(gw: GatewayClient, project: ProjectInfo, sid: string): Promise<string> {
  const path = projectPath(project)

  if (!path) {
    throw new Error(`project "${project.name}" has no folder — add one in the desktop sidebar`)
  }

  // Fire-and-forget: a move the user asked for must not fail because the pointer write lost a race.
  void gw.request('projects.set_active', { id: project.id }).catch(() => undefined)

  const refusals: string[] = []

  const local: Array<[string, Record<string, unknown>]> = [
    ['session.workspace.move', { cwd: path, session_key: sid }],
    ['session.cwd.set', { cwd: path, session_id: sid }]
  ]

  for (const [verb, params] of local) {
    try {
      const r = await gw.request<SessionsCwdResponse>(verb, params)

      return r?.cwd || path
    } catch (e: unknown) {
      refusals.push(wireText(e))
    }
  }

  // Only reach for the owner's verb when the local ones were MISSING (not refused): a backend that
  // answers them has already said what it thinks, and a real refusal is authoritative there.
  if (refusals.length && refusals.every(missingVerb)) {
    try {
      const mutation = await mutateCanonical(gw, sid, 'workspace', { cwd: path })
      const cwd = asRpcResult(mutation?.result)?.cwd

      return typeof cwd === 'string' && cwd ? cwd : path
    } catch (e: unknown) {
      refusals.push(wireText(e))
    }
  }

  // A real refusal ("session busy", a read-only mount, an unresolvable cwd) explains more than the
  // missing-verb answers collected before it, so it wins.
  const refusal = refusals.find(text => text && !missingVerb(text))

  if (refusal) {
    throw new Error(rpcErrorMessage(refusal))
  }

  throw new Error(
    `moving a session needs a backend that re-homes workspaces — this one answers none of ` +
      `session.workspace.move, session.cwd.set or session.mutate(workspace), so ${project.name} was not opened`
  )
}
