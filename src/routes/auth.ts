import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { userService, UserServiceError } from '../services/userService.js';
import { validatePasswordStrength } from '../utils/password.js';
import { metrics, METRICS } from '../services/metrics.js';

const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/signup
  app.post('/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = signupSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { email, password } = parseResult.data;

    // Validate password strength
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return reply.status(400).send({
        error: 'Password too weak',
        details: passwordCheck.errors,
      });
    }

    try {
      const result = await userService.createUser({ email, password });

      await metrics.increment(METRICS.USERS_REGISTERED);

      return reply.status(201).send({
        message: 'Account created successfully',
        user: {
          id: result.user.id,
          email: result.user.email,
        },
        token: result.token,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        if (error.code === 'EMAIL_EXISTS') {
          return reply.status(409).send({
            error: 'Email already registered',
          });
        }
      }
      throw error;
    }
  });

  // POST /auth/login
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = loginSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { email, password } = parseResult.data;

    try {
      const result = await userService.login({ email, password });

      return reply.status(200).send({
        message: 'Login successful',
        user: {
          id: result.user.id,
          email: result.user.email,
        },
        token: result.token,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        if (error.code === 'INVALID_CREDENTIALS') {
          return reply.status(401).send({
            error: 'Invalid email or password',
          });
        }
      }
      throw error;
    }
  });

  // GET /auth/me (protected)
  app.get('/auth/me', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user?.userId;

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const user = await userService.getUserById(userId);

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const dailySearchCount = await userService.getDailySearchCount(userId);

    return reply.status(200).send({
      user: {
        id: user.id,
        email: user.email,
        dailySearchCount,
        dailySearchLimit: 10,
      },
    });
  });
}
