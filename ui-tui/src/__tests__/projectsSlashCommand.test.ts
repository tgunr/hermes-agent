import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $overlayState, hasFloatingPanel, patchOverlayState } from '../app/overlayStore.js'
import { findProject, projectLines, projectPath, projectsCommands } from '../app/slash/commands/projects.js'
import { projectRows } from '../domain/projects.js'
import type { ProjectInfo } from '../types.js'

const project = (over: Partial<ProjectInfo>): ProjectInfo => ({
  created_at: 0,
  id: 'p_1',
  name: 'Designs',
  slug: 'designs',
  ...over
})

const projects: ProjectInfo[] = [
  project({ id: 'p_a', name: 'Alpha', primary_path: '/work/alpha', slug: 'alpha' }),
  project({
    folders: [
      { is_primary: true, path: '/work/beta-current' },
      { is_primary: false, path: '/work/beta-old' }
    ],
    id: 'p_b',
    name: 'Beta Project',
    primary_path: null,
    slug: 'beta'
  })
]

describe('projectPath', () => {
  it('prefers primary_path, then the folder flagged primary', () => {
    expect(projectPath(projects[0]!)).toBe('/work/alpha')
    expect(projectPath(projects[1]!)).toBe('/work/beta-current')
  })

  it('is empty for a project with no folder', () => {
    expect(projectPath(project({ primary_path: null }))).toBe('')
  })
})

describe('findProject', () => {
  it('resolves id, slug and exact name', () => {
    expect(findProject(projects, 'p_b')?.name).toBe('Beta Project')
    expect(findProject(projects, 'beta')?.name).toBe('Beta Project')
    expect(findProject(projects, 'Beta Project')?.slug).toBe('beta')
  })

  it('falls back to a case-insensitive slug or name', () => {
    expect(findProject(projects, 'ALPHA')?.id).toBe('p_a')
    expect(findProject(projects, 'beta')?.id).toBe('p_b')
  })

  it('resolves nothing for a blank or unknown token', () => {
    expect(findProject(projects, '  ')).toBeUndefined()
    expect(findProject(projects, 'gamma')).toBeUndefined()
  })
})

describe('projectLines', () => {
  it('marks the active project and the one holding the session cwd', () => {
    const [alpha, beta] = projectLines(projects, 'p_a', '/work/beta-current/src')

    expect(alpha).toContain('●')
    expect(alpha).not.toContain('← here')
    expect(beta).not.toContain('●')
    expect(beta).toContain('← here')
  })

  it('does not treat a sibling path with the same prefix as inside the project', () => {
    const [, beta] = projectLines(projects, null, '/work/beta-current-old')

    expect(beta).not.toContain('← here')
  })
})

describe('projectRows', () => {
  it('puts the active project first and marks the folder the session is in', () => {
    const rows = projectRows(projects, 'p_b', '/work/alpha/src')

    expect(rows[0]!.project.id).toBe('p_b')
    expect(rows[0]!.active).toBe(true)
    expect(rows.find(row => row.project.id === 'p_a')!.here).toBe(true)
    expect(rows.find(row => row.project.id === 'p_b')!.here).toBe(false)
  })
})

describe('/projects command', () => {
  const ctxWith = (opts: {
    arg: string
    busy?: boolean
    request: ReturnType<typeof vi.fn>
    sys: ReturnType<typeof vi.fn>
  }) => {
    const page = vi.fn()

    const guarded =
      <T>(fn: (r: T) => void) =>
      (r: null | T) => {
        if (r) {
          fn(r)
        }
      }

    return {
      ctx: {
        gateway: { gw: { request: opts.request }, rpc: opts.request },
        guarded,
        guardedErr: vi.fn(),
        sid: 'sid-1',
        stale: () => false,
        transcript: { page, sys: opts.sys },
        ui: { busy: opts.busy ?? false, info: { cwd: '/work/alpha' } }
      },
      page
    }
  }

  beforeEach(() => patchOverlayState({ projectsPicker: false }))

  // The picker only PAINTS if `hasFloatingPanel` sees its flag: `$isBlocked` (which suspends
  // composer input) lists it separately, so a missing entry here renders nothing while every
  // keystroke goes nowhere — the command looks hung.
  it('counts the picker as a floating panel, so setting the flag actually paints it', () => {
    patchOverlayState({ projectsPicker: true })

    expect(hasFloatingPanel($overlayState.get())).toBe(true)
  })

  it('opens the interactive picker on a bare /projects (no text wall)', () => {
    const request = vi.fn().mockResolvedValue({ active_id: 'p_a', projects })
    const sys = vi.fn()
    const { ctx, page } = ctxWith({ arg: '', request, sys })

    projectsCommands[0]!.run('', ctx as never, '/projects')

    expect($overlayState.get().projectsPicker).toBe(true)
    expect(page).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('prints the list for an explicit "list" argument', async () => {
    const request = vi.fn().mockResolvedValue({ active_id: 'p_a', projects })
    const sys = vi.fn()
    const { ctx, page } = ctxWith({ arg: 'list', request, sys })

    projectsCommands[0]!.run('list', ctx as never, '/projects list')

    await vi.waitFor(() => expect(page).toHaveBeenCalled())

    expect(request).toHaveBeenCalledWith('projects.list', {})
    expect(page.mock.calls[0]![1]).toBe('Projects')
    expect(page.mock.calls[0]![0]).toContain('Alpha')
  })

  it('activates the project and moves the live session into its folder', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ active_id: null, projects })
      .mockResolvedValue({ cwd: '/work/beta-current' })

    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(request).toHaveBeenCalledWith('projects.set_active', { id: 'p_b' })
    expect(request).toHaveBeenCalledWith('session.workspace.move', { cwd: '/work/beta-current', session_key: 'sid-1' })
  })

  it('falls back to session.cwd.set when the durable-key verb is refused', async () => {
    const request = vi.fn((method: string) => {
      if (method === 'projects.list') {
        return Promise.resolve({ active_id: null, projects })
      }

      return method === 'session.workspace.move'
        ? Promise.reject(new Error('session not found'))
        : Promise.resolve({ cwd: '/work/beta-current' })
    })

    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(request).toHaveBeenCalledWith('session.cwd.set', { cwd: '/work/beta-current', session_id: 'sid-1' })
    expect(sys.mock.calls[0]![0]).toContain('Beta Project')
  })

  it('refuses to move while a turn is running', async () => {
    const request = vi.fn().mockResolvedValue({ active_id: null, projects })
    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', busy: true, request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(sys.mock.calls[0]![0]).toContain('session busy')
    expect(request).not.toHaveBeenCalledWith('session.cwd.set', expect.anything())
  })

  it('reports an unknown project instead of doing nothing', async () => {
    const request = vi.fn().mockResolvedValue({ active_id: null, projects })
    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'nope', request, sys })

    projectsCommands[0]!.run('nope', ctx as never, '/projects nope')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(sys.mock.calls[0]![0]).toContain('no Project matches')
  })

  // A shared/canonical owner (`hermes-gateway-v1`) serves neither local workspace verb: the move is
  // its revision-fenced `session.mutate` with operation `workspace`.
  it('falls back to the canonical session.mutate workspace when both local verbs are missing', async () => {
    const request = vi.fn((method: string) => {
      if (method === 'projects.list') {
        return Promise.resolve({ active_id: null, projects })
      }

      if (method === 'session.resume') {
        return Promise.resolve({ execution_generation: 3, revision: 7 })
      }

      if (method === 'session.mutate') {
        return Promise.resolve({ cwd: '/work/beta-current', status: 'applied' })
      }

      return Promise.reject(new Error(`unknown method: ${method} — not available on this Hermes backend`))
    })

    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(request).toHaveBeenCalledWith(
      'session.mutate',
      expect.objectContaining({
        expected_generation: 3,
        expected_revision: 7,
        operation: 'workspace',
        payload: { cwd: '/work/beta-current' },
        session_id: 'sid-1'
      })
    )
    expect(sys.mock.calls[0]![0]).toContain('Beta Project')
    expect(sys.mock.calls[0]![0]).toContain('/work/beta-current')
  })

  // The wire text says "unknown method: session.cwd.set", which the client translates to a generic
  // "does not provide …" line. The copy after all three verbs fail must say nothing was moved.
  it('names the missing workspace verbs instead of the translated unknown-method copy', async () => {
    const request = vi.fn((method: string) =>
      method === 'projects.list'
        ? Promise.resolve({ active_id: null, projects })
        : Promise.reject(new Error(`unknown method: ${method} — not available on this Hermes backend`))
    )

    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(sys.mock.calls[0]![0]).toContain('answers none of')
    expect(sys.mock.calls[0]![0]).toContain('was not opened')
    expect(sys.mock.calls[0]![0]).not.toContain('does not provide')
  })

  // A refusal that explains itself ("session busy", a bad folder) outranks the missing-verb noise.
  it('surfaces a real refusal rather than the missing-verb copy', async () => {
    const request = vi.fn((method: string) => {
      if (method === 'projects.list') {
        return Promise.resolve({ active_id: null, projects })
      }

      return Promise.reject(
        Object.assign(new Error('session busy'), { data: { reason: 'session_busy' } })
      )
    })

    const sys = vi.fn()
    const { ctx } = ctxWith({ arg: 'beta', request, sys })

    projectsCommands[0]!.run('beta', ctx as never, '/projects beta')

    await vi.waitFor(() => expect(sys).toHaveBeenCalled())

    expect(sys.mock.calls[0]![0]).toContain('session busy')
    expect(sys.mock.calls[0]![0]).not.toContain('answers none of')
    // A backend that ANSWERS the local verbs is not re-asked through the owner's mutation.
    expect(request).not.toHaveBeenCalledWith('session.mutate', expect.anything())
  })
})
