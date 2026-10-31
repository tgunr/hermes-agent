import { findProject, moveSessionInto, projectLines } from '../../../domain/projects.js'
import { rpcErrorMessage } from '../../../lib/rpc.js'
import type { ProjectInfo } from '../../../types.js'
import { patchOverlayState } from '../../overlayStore.js'
import type { SlashCommand, SlashRunCtx } from '../types.js'

/** `/projects` — the TUI's own handle on Projects (per-profile `projects.db`, the desktop
 *  sidebar's named workspaces). Bare `/projects` opens the interactive picker (arrows + Enter move
 *  the session); `/projects <name|slug>` switches directly; `/projects list` prints the list. It
 *  runs here, not in the slash worker, because the worker is a shadow process: it can list the DB
 *  but cannot move the LIVE session's workspace. */

export { findProject, projectLines, projectPath } from '../../../domain/projects.js'

interface ProjectsListResponse {
  active_id?: null | string
  projects?: ProjectInfo[]
}

const listProjects = (projects: ProjectInfo[], activeId: null | string | undefined, ctx: SlashRunCtx): void => {
  if (!projects.length) {
    return ctx.transcript.sys('no Projects yet — create one in the desktop sidebar, or ask the agent to project_create')
  }

  const cwd = ctx.ui.info?.cwd || ''

  const lines = [
    `${projects.length} Projects — /projects opens the picker, /projects <name|slug> switches directly:`,
    ...projectLines(projects, activeId, cwd)
  ]

  ctx.transcript.page(lines.join('\n'), 'Projects')
}

const switchProject = (project: ProjectInfo, ctx: SlashRunCtx): void => {
  if (!ctx.sid) {
    return ctx.transcript.sys('no live session to move — send a message first, then /projects ' + project.slug)
  }

  if (ctx.ui.busy) {
    return ctx.transcript.sys(`session busy — stop the turn, then run /projects ${project.slug}`)
  }

  moveSessionInto(ctx.gateway.gw, project, ctx.sid)
    .then(ctx.guarded<string>(cwd => ctx.transcript.sys(`✓ ${project.name} — ${cwd}`)))
    .catch((e: unknown) => {
      if (!ctx.stale()) {
        ctx.transcript.sys(`error: ${rpcErrorMessage(e)}`)
      }
    })
}

export const projectsCommands: SlashCommand[] = [
  {
    aliases: ['proj'],
    help: 'open the Projects picker, or move this session into one (name|slug)',
    name: 'projects',
    run: (arg, ctx) => {
      const token = arg.trim()

      // Bare (or an explicit `pick`) opens the navigable list: the point of the command is to
      // choose a folder, and typing a name every time is worse than arrowing to it.
      if (!token || token === 'pick') {
        return patchOverlayState({ projectsPicker: true })
      }

      if (token === 'list') {
        return ctx.gateway
          .rpc<ProjectsListResponse>('projects.list', {})
          .then(ctx.guarded<ProjectsListResponse>(r => listProjects(r?.projects ?? [], r?.active_id, ctx)))
          .catch(ctx.guardedErr)
      }

      ctx.gateway
        .rpc<ProjectsListResponse>('projects.list', {})
        .then(
          ctx.guarded<ProjectsListResponse>(r => {
            const target = findProject(r?.projects ?? [], token)

            return target
              ? switchProject(target, ctx)
              : ctx.transcript.sys(`no Project matches "${token}" — /projects opens the picker`)
          })
        )
        .catch(ctx.guardedErr)
    },
    usage: '[name|slug | list | pick]'
  }
]
