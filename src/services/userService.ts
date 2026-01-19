import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
import type { User } from '@prisma/client';

export interface CreateUserInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: Omit<User, 'password'>;
  token: string;
}

export class UserServiceError extends Error {
  constructor(
    message: string,
    public code: 'EMAIL_EXISTS' | 'INVALID_CREDENTIALS' | 'USER_NOT_FOUND'
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

export const userService = {
  async createUser(input: CreateUserInput): Promise<AuthResult> {
    const { email, password } = input;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new UserServiceError('Email already registered', 'EMAIL_EXISTS');
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
      },
    });

    logger.info({ userId: user.id, email: user.email }, 'User created');

    const token = generateToken({ userId: user.id, email: user.email });

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const { email, password } = input;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new UserServiceError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const passwordValid = await verifyPassword(password, user.password);

    if (!passwordValid) {
      throw new UserServiceError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    logger.info({ userId: user.id, email: user.email }, 'User logged in');

    const token = generateToken({ userId: user.id, email: user.email });

    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  },

  async getUserById(userId: string): Promise<Omit<User, 'password'> | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  },

  async updateDailySearchCount(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return;
    }

    // Reset count if last search was on a different day
    const lastSearchDate = user.lastSearchDate;
    const isNewDay = !lastSearchDate || lastSearchDate < today;

    await prisma.user.update({
      where: { id: userId },
      data: {
        dailySearchCount: isNewDay ? 1 : { increment: 1 },
        lastSearchDate: new Date(),
      },
    });
  },

  async getDailySearchCount(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return 0;
    }

    // If last search was before today, count is 0
    if (!user.lastSearchDate || user.lastSearchDate < today) {
      return 0;
    }

    return user.dailySearchCount;
  },
};
