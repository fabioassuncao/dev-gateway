// Who the panel's users are, as the API returns them.
//
// A user never crosses this boundary with anything that authenticates them: no
// hash, no session token, no api-key secret. What a caller gets is a name, a
// role, whether the account is usable, and which Projects it reaches.

import { z } from 'zod'
import { ROLES } from 'portta-core/browser'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const Role = named(z.enum(ROLES).describe('What this account may do, everywhere'), 'Role')
export type Role = z.infer<typeof Role>

export const User = named(
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: Role,
    /** A banned account keeps its rows and stops working on its next request. */
    banned: z.boolean(),
    banReason: z.string().nullable(),
    banExpires: unixSeconds.nullable(),
    twoFactorEnabled: z.boolean(),
    createdAt: unixSeconds,
    /** The Projects this account reaches. Empty and meaningless for owner and admin, who see everything. */
    projects: z.array(z.object({ id: z.number(), slug: z.string(), name: z.string() }).strict()),
  }).strict(),
  'User',
)
export type User = z.infer<typeof User>

export const Users = named(z.object({ users: z.array(User) }).strict(), 'Users')
export type Users = z.infer<typeof Users>

export const CreateUser = named(
  z.object({
    name: z.string().min(1).max(120),
    email: z.email(),
    password: z.string().min(10).max(128),
    role: Role.default('viewer'),
    /** Project ids this account starts with. Ignored for owner and admin. */
    projects: z.array(z.number().int().positive()).max(200).optional(),
  }).strict(),
  'CreateUser',
)
export type CreateUser = z.infer<typeof CreateUser>

export const SetRole = named(z.object({ role: Role }).strict(), 'SetRole')
export type SetRole = z.infer<typeof SetRole>

export const SetPassword = named(
  z.object({ password: z.string().min(10).max(128) }).strict(),
  'SetPassword',
)
export type SetPassword = z.infer<typeof SetPassword>

export const BanUser = named(
  z.object({
    banned: z.boolean(),
    reason: z.string().max(500).optional(),
    /** Days from now. Absent means until somebody lifts it. */
    days: z.number().int().min(1).max(3650).optional(),
  }).strict(),
  'BanUser',
)
export type BanUser = z.infer<typeof BanUser>

export const SetUserProjects = named(
  z.object({ projects: z.array(z.number().int().positive()).max(200) }).strict(),
  'SetUserProjects',
)
export type SetUserProjects = z.infer<typeof SetUserProjects>

/** One open session of a user, so somebody can see and end it. */
export const UserSession = named(
  z.object({
    id: z.string(),
    createdAt: unixSeconds,
    expiresAt: unixSeconds,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  }).strict(),
  'UserSession',
)
export type UserSession = z.infer<typeof UserSession>

export const UserSessions = named(z.object({ sessions: z.array(UserSession) }).strict(), 'UserSessions')
export type UserSessions = z.infer<typeof UserSessions>
