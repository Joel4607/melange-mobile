import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { DataModel } from './_generated/dataModel';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password<DataModel>({
    profile(params) {
      const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ConvexError('Enter a valid email address.');
      }
      if (params.flow === 'signUp') {
        const name = typeof params.name === 'string' ? params.name.trim() : '';
        if (name.length < 2 || name.length > 80) throw new ConvexError('Your name must be 2–80 characters.');
        const role = params.role ?? 'buyer';
        if (role !== 'buyer' && role !== 'runner') throw new ConvexError('Choose Buyer or Runner.');
        return { email, name, role };
      }
      return { email };
    },
    validatePasswordRequirements(password) {
      if (password.length < 8 || password.length > 128) throw new ConvexError('Use a password of 8–128 characters.');
    },
  })],
});
