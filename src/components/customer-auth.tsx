import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';
import { useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui } from './customer-ui';
import { RoleOptions } from './account-role';

export function CustomerAuth({ purpose = 'Sign in to open your Melange dashboard.', runner = false }: { purpose?: string; runner?: boolean }) {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<'signIn' | 'signUp'>(runner ? 'signUp' : 'signIn');
  const [role, setRole] = useState<'buyer' | 'runner'>(runner ? 'runner' : 'buyer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');

  async function submit() {
    if (locked.current) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (mode === 'signUp' && name.trim().length < 2) return setError('Enter your name (at least 2 characters).');
    if (password.length < 8 || password.length > 128) return setError('Use a password of 8–128 characters.');
    if (mode === 'signUp' && password !== confirm) return setError('Your passwords do not match.');
    locked.current = true; setBusy(true);
    try {
      await signIn('password', { flow: mode, email: email.trim().toLowerCase(), password, ...(mode === 'signUp' ? { name: name.trim(), role } : {}) });
      setPassword(''); setConfirm('');
    } catch {
      setError(mode === 'signIn' ? 'Could not sign in. Check your email, password and connection, then try again.' : 'Could not create your account. If you already registered, try signing in. Otherwise check your connection and retry.');
    } finally { locked.current = false; setBusy(false); }
  }

  return <CustomerPage>
    <Text style={ui.eyebrow}>{mode === 'signUp' && role === 'runner' ? 'BECOME A RUNNER · STEP 1 OF 2' : 'YOUR MELANGE ACCOUNT'}</Text>
    <Text style={ui.title}>{mode === 'signIn' ? 'Welcome back.' : role === 'runner' ? 'Become a runner.' : 'A little help starts here.'}</Text>
    <Text style={ui.body}>{mode === 'signIn' ? purpose : 'Choose your role and create an account. Each role has its own dashboard.'}</Text>
    {mode === 'signUp' && <RoleOptions value={role} onChange={setRole} disabled={busy} />}
    <View style={ui.card}>
      {mode === 'signUp' && <CustomerField label="Your name" value={name} onChangeText={setName} autoComplete="name" maxLength={80} editable={!busy} />}
      <CustomerField label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} editable={!busy} placeholder="you@example.com" />
      <CustomerField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} maxLength={128} editable={!busy} hint={mode === 'signUp' ? 'At least 8 characters. Save it somewhere safe.' : undefined} />
      {mode === 'signUp' && <CustomerField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} editable={!busy} />}
      <FormError message={error} />
      <CustomerButton disabled={busy} onPress={() => void submit()}>{busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : role === 'runner' ? 'Create runner account' : 'Create buyer account'}</CustomerButton>
      <Pressable disabled={busy} accessibilityRole="button" onPress={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(''); setPassword(''); setConfirm(''); }} style={{ padding: 13 }}><Text style={[ui.h3, { textAlign: 'center' }]}>{mode === 'signIn' ? 'New here? Create an account' : 'Already registered? Sign in'}</Text></Pressable>
    </View>
    <Text style={ui.small}>Prototype accounts use email and password. Email verification and password recovery are not available yet.</Text>
  </CustomerPage>;
}

export function RequireCustomer({ children }: PropsWithChildren) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <CustomerPage><ActivityIndicator color={palette.green} /><Text style={ui.body}>Restoring your session…</Text></CustomerPage>;
  if (!isAuthenticated) return <CustomerAuth />;
  return children;
}
