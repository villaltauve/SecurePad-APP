import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const USERS_FILE_NAME = 'securepad-users.dat';
const USERS_HEADER = 'SECUREPAD_USERS::';
const USER_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const USER_STORE_SECRET =
  process.env.SECUREPAD_USER_SECRET && process.env.SECUREPAD_USER_SECRET.trim().length > 0
    ? process.env.SECUREPAD_USER_SECRET
    : 'securepad-user-store-secret';

const passwordIterations = 180_000;
const passwordKeyLength = 32;
const streakDefaultState = () => ({
  currentStreak: 0,
  longestStreak: 0,
  lastCompletedDate: null,
});

const normalizeUsername = (username) => username.trim().toLowerCase();

const getUsersFilePath = () => path.join(app.getPath('userData'), USERS_FILE_NAME);

const ensureValidUsername = (username) => {
  if (typeof username !== 'string') {
    throw new Error('Nombre de usuario inválido.');
  }
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    throw new Error('El usuario debe tener al menos 3 caracteres.');
  }
  if (trimmed.length > 64) {
    throw new Error('El usuario no puede superar 64 caracteres.');
  }
  if (!/^[\p{L}\p{N}_\-.]+$/u.test(trimmed)) {
    throw new Error('El usuario solo puede incluir letras, números, guiones y guiones bajos.');
  }
  return trimmed;
};

const ensureValidPassword = (password) => {
  if (typeof password !== 'string') {
    throw new Error('Contraseña inválida.');
  }
  if (password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  if (password.length > 128) {
    throw new Error('La contraseña no puede superar 128 caracteres.');
  }
  return password;
};

const deriveUserStoreKey = (saltBuffer) =>
  crypto.pbkdf2Sync(USER_STORE_SECRET, saltBuffer, 140_000, 32, 'sha256');

const encryptUserStore = (payload) => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveUserStoreKey(salt);
  const cipher = crypto.createCipheriv(USER_ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const bundle = {
    v: 1,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: authTag.toString('base64url'),
    data: encrypted.toString('base64url'),
  };

  return `${USERS_HEADER}${Buffer.from(JSON.stringify(bundle)).toString('base64url')}`;
};

const decryptUserStore = (content) => {
  if (!content || typeof content !== 'string') {
    return null;
  }
  if (!content.startsWith(USERS_HEADER)) {
    return null;
  }

  const encoded = content.slice(USERS_HEADER.length);
  const payloadBuffer = Buffer.from(encoded, 'base64url');
  const payload = JSON.parse(payloadBuffer.toString('utf8'));

  const salt = Buffer.from(payload.salt, 'base64url');
  const iv = Buffer.from(payload.iv, 'base64url');
  const encrypted = Buffer.from(payload.data, 'base64url');
  const authTag = Buffer.from(payload.tag, 'base64url');

  const key = deriveUserStoreKey(salt);
  const decipher = crypto.createDecipheriv(USER_ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

const readUsers = async () => {
  try {
    const raw = await fs.readFile(getUsersFilePath(), 'utf8');
    const decrypted = decryptUserStore(raw);
    if (!decrypted) {
      return [];
    }
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeUsers = async (users) => {
  const payload = JSON.stringify(users);
  const encrypted = encryptUserStore(payload);
  await fs.writeFile(getUsersFilePath(), encrypted, { encoding: 'utf8' });
};

const hashPassword = (password, salt = crypto.randomBytes(16)) => {
  const derived = crypto.pbkdf2Sync(password, salt, passwordIterations, passwordKeyLength, 'sha512');
  return {
    salt: salt.toString('base64url'),
    hash: derived.toString('base64url'),
  };
};

const verifyPasswordHash = (password, stored) => {
  if (!stored || !stored.salt || !stored.hash) {
    return false;
  }
  const salt = Buffer.from(stored.salt, 'base64url');
  const derived = crypto.pbkdf2Sync(password, salt, passwordIterations, passwordKeyLength, 'sha512');
  const derivedEncoded = derived.toString('base64url');
  return crypto.timingSafeEqual(Buffer.from(derivedEncoded), Buffer.from(stored.hash));
};

const presentUser = (user) => ({
  username: user.username,
  stats: {
    currentStreak: user.stats?.currentStreak ?? 0,
    longestStreak: user.stats?.longestStreak ?? 0,
    lastCompletedDate: user.stats?.lastCompletedDate ?? null,
  },
});

export const hasAnyUsers = async () => {
  const users = await readUsers();
  return users.length > 0;
};

export const createUser = async (usernameInput, passwordInput) => {
  const username = ensureValidUsername(usernameInput);
  const password = ensureValidPassword(passwordInput);
  const normalized = normalizeUsername(username);
  const users = await readUsers();

  if (users.some((user) => user.normalized === normalized)) {
    throw new Error('El usuario ya existe.');
  }

  const now = new Date().toISOString();
  const passwordData = hashPassword(password);
  const userRecord = {
    username,
    normalized,
    password: passwordData,
    stats: streakDefaultState(),
    createdAt: now,
    updatedAt: now,
  };

  await writeUsers([...users, userRecord]);
  return presentUser(userRecord);
};

export const authenticateUser = async (usernameInput, passwordInput) => {
  const username = ensureValidUsername(usernameInput);
  const password = ensureValidPassword(passwordInput);
  const normalized = normalizeUsername(username);
  const users = await readUsers();
  const userIndex = users.findIndex((candidate) => candidate.normalized === normalized);

  if (userIndex === -1) {
    throw new Error('El usuario o la contraseña no son válidos.');
  }

  const userRecord = users[userIndex];
  if (!verifyPasswordHash(password, userRecord.password)) {
    throw new Error('El usuario o la contraseña no son válidos.');
  }

  users[userIndex] = {
    ...userRecord,
    updatedAt: new Date().toISOString(),
  };
  await writeUsers(users);

  return presentUser(users[userIndex]);
};

export const markDailyGoal = async (usernameInput, targetDateISO) => {
  const username = ensureValidUsername(usernameInput);
  const normalized = normalizeUsername(username);
  const users = await readUsers();
  const userIndex = users.findIndex((candidate) => candidate.normalized === normalized);

  if (userIndex === -1) {
    throw new Error('Usuario no encontrado.');
  }

  const userRecord = users[userIndex];
  const stats = userRecord.stats ?? streakDefaultState();
  const todayKey = targetDateISO;

  if (stats.lastCompletedDate === todayKey) {
    return presentUser(userRecord).stats;
  }

  let newCurrent = 1;
  if (stats.lastCompletedDate) {
    const lastDate = new Date(stats.lastCompletedDate);
    const todayDate = new Date(todayKey);
    const difference = todayDate.getTime() - lastDate.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (difference <= dayMs + 5 * 60 * 1000 && difference >= dayMs - 5 * 60 * 1000) {
      newCurrent = (stats.currentStreak ?? 0) + 1;
    }
  }

  const updatedStats = {
    currentStreak: newCurrent,
    longestStreak: Math.max(newCurrent, stats.longestStreak ?? 0),
    lastCompletedDate: todayKey,
  };

  users[userIndex] = {
    ...userRecord,
    stats: updatedStats,
    updatedAt: new Date().toISOString(),
  };

  await writeUsers(users);
  return updatedStats;
};

