import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HermesModule from '@/hermes'
import { getSession } from '@/hermes'
import { $activeGatewayProfile, $profiles } from '@/store/profile'
import { $sessions, getRememberedSessionId, setRememberedSessionId } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { resolveSessionProfile, resolveStoredSession } from './utils'

vi.mock('@/hermes', async importActual => ({
  ...(await importActual<typeof HermesModule>()),
  getSession: vi.fn()
}))

// Mock the remembered-last-session helpers so we can assert the dead-id eviction
// without touching Electron localStorage. The rest of @/store/session is real.
vi.mock('@/store/session', async importActual => ({
  ...(await importActual<typeof import('@/store/session')>()),
  getRememberedSessionId: vi.fn(),
  setRememberedSessionId: vi.fn()
}))

const mockGetSession = vi.mocked(getSession)
const mockGetRememberedSessionId = vi.mocked(getRememberedSessionId)
const mockSetRememberedSessionId = vi.mocked(setRememberedSessionId)

const session = (over: Partial<SessionInfo>): SessionInfo => over as SessionInfo

const profiles = (...names: string[]) => names.map(name => ({ name }) as never)

describe('resolveStoredSession profile ownership', () => {
  beforeEach(() => {
    $sessions.set([])
    $profiles.set(profiles('default', 'meta'))
    $activeGatewayProfile.set('meta')
    mockGetSession.mockReset()
    mockGetRememberedSessionId.mockReset()
    mockSetRememberedSessionId.mockReset()
  })

  afterEach(() => {
    $sessions.set([])
    $profiles.set([])
    $activeGatewayProfile.set('default')
  })

  it('returns a cached row that carries an owning profile', async () => {
    $sessions.set([session({ id: 's1', profile: 'default' })])

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.profile).toBe('default')
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('treats a profile-less cache hit as unresolved when multiple profiles exist', async () => {
    $sessions.set([session({ id: 's1' })])
    mockGetSession.mockRejectedValueOnce(new Error('404: Session not found'))
    mockGetSession.mockResolvedValueOnce(session({ id: 's1', profile: 'default' }))

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.profile).toBe('default')
    // rung 2 (bare) then rung 3 (stamped cross-profile probe)
    expect(mockGetSession).toHaveBeenNthCalledWith(1, 's1')
    expect(mockGetSession).toHaveBeenNthCalledWith(2, 's1', 'default')
  })

  it('accepts a profile-less cache hit for single-profile users', async () => {
    $profiles.set(profiles('default'))
    $sessions.set([session({ id: 's1' })])

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.id).toBe('s1')
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('stamps the active profile on a bare by-id hit from an older backend', async () => {
    mockGetSession.mockResolvedValueOnce(session({ id: 's1' }))

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.profile).toBe('meta')
    // the upserted cache row is owned too, so the next hit short-circuits
    expect($sessions.get().find(s => s.id === 's1')?.profile).toBe('meta')
  })

  it('probed desktop profile overrides a remote backend answering as its own "default"', async () => {
    // Per-profile remote override: Electron strips the desktop alias before
    // forwarding, so the standalone backend stamps its backend-local root.
    mockGetSession.mockRejectedValueOnce(new Error('404: Session not found'))
    mockGetSession.mockResolvedValueOnce(session({ id: 's1', profile: 'default' }))
    $activeGatewayProfile.set('default')
    $profiles.set(profiles('default', 'meta'))

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.profile).toBe('meta')
    expect($sessions.get().find(s => s.id === 's1')?.profile).toBe('meta')
  })

  it('stamps the probed profile on a scoped hit from an older backend that omits it', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('404: Session not found'))
    mockGetSession.mockResolvedValueOnce(session({ id: 's1' }))

    const resolved = await resolveStoredSession('s1')

    expect(resolved?.profile).toBe('default')
    // the cached row is owned too — no unowned row is ever re-cached
    expect($sessions.get().find(s => s.id === 's1')?.profile).toBe('default')
  })

  it('resolveSessionProfile routes a default-profile session from a non-default gateway', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('404: Session not found'))
    mockGetSession.mockResolvedValueOnce(session({ id: 's1', profile: 'default' }))

    await expect(resolveSessionProfile('s1')).resolves.toBe('default')
  })

  it('forgets a remembered last-session id that 404s on every profile', async () => {
    // The persisted last session was purged from the backend (cross-profile
    // rotation, manual delete). getSession 404s on the active profile and all
    // others — the id is genuinely dead and must be forgotten so a cold start
    // doesn't re-404 every launch.
    $profiles.set(profiles('default', 'meta'))
    $activeGatewayProfile.set('meta')
    mockGetRememberedSessionId.mockReturnValue('gone')
    mockGetSession.mockRejectedValue(new Error('404: Session not found'))

    const resolved = await resolveStoredSession('gone')

    expect(resolved).toBeUndefined()
    expect(mockSetRememberedSessionId).toHaveBeenCalledWith(null, 'meta')
  })

  it('does NOT forget the remembered id on a transient (non-404) error', async () => {
    $profiles.set(profiles('default', 'meta'))
    $activeGatewayProfile.set('meta')
    mockGetRememberedSessionId.mockReturnValue('flaky')
    mockGetSession.mockRejectedValue(new Error('500: Internal Server Error'))

    const resolved = await resolveStoredSession('flaky')

    expect(resolved).toBeUndefined()
    expect(mockSetRememberedSessionId).not.toHaveBeenCalled()
  })
})
