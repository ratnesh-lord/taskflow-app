import { render, screen, userEvent } from '@testing-library/react-native';

import Setup from '@/app/setup';
import SignIn from '@/app/sign-in';
import SignUp from '@/app/sign-up';
import { signInWithEmail, signUpWithEmail } from '@/platform/auth';
import { Segmented } from '@/ui/Segmented';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/platform/kv', () => ({
  kv: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));

jest.mock('@/platform/auth', () => ({
  signInWithEmail: jest.fn(),
  signInWithGoogle: jest.fn(),
  signUpWithEmail: jest.fn(),
}));

const signInMock = jest.mocked(signInWithEmail);
const signUpMock = jest.mocked(signUpWithEmail);

describe('sign-in screen', () => {
  it('keeps the button off until both fields are filled, then signs in with what was typed', async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    await render(<SignIn />);

    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Email'), ' me@example.com ');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    expect(button).toBeEnabled();

    await user.press(button);
    expect(signInMock).toHaveBeenCalledWith(' me@example.com ', 'correct horse');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the reason when sign-in fails', async () => {
    signInMock.mockResolvedValue({ ok: false, message: 'That email and password do not match an account.' });
    const user = userEvent.setup();
    await render(<SignIn />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That email and password do not match an account.');
  });

  it('links to account creation and password reset', async () => {
    const user = userEvent.setup();
    await render(<SignIn />);
    await user.press(screen.getByRole('button', { name: 'Create account' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-up');
    await user.press(screen.getByRole('button', { name: 'Forgot password' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/reset-password');
  });
});

describe('sign-up screen', () => {
  it('refuses a short password and says how many characters are missing', async () => {
    const user = userEvent.setup();
    await render(<SignUp />);

    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'short');

    expect(screen.getByText('3 more to go.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('tells the user to confirm their email when the server asks for it', async () => {
    signUpMock.mockResolvedValue({ ok: true, note: 'Check your inbox: open the confirmation link, then sign in.' });
    const user = userEvent.setup();
    await render(<SignUp />);

    await user.type(screen.getByLabelText('Name'), 'Ratnesh');
    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'long enough');
    await user.press(screen.getByRole('button', { name: 'Create account' }));

    expect(signUpMock).toHaveBeenCalledWith('Ratnesh', 'me@example.com', 'long enough');
    expect(await screen.findByText(/Check your inbox/)).toBeOnTheScreen();
  });
});

describe('setup screen', () => {
  it('names both settings the build is missing', async () => {
    await render(<Setup />);
    expect(screen.getByText(/EXPO_PUBLIC_SUPABASE_URL/)).toBeOnTheScreen();
    expect(screen.getByText(/EXPO_PUBLIC_SUPABASE_KEY/)).toBeOnTheScreen();
  });
});

describe('Segmented', () => {
  it('marks the current option and reports a new choice', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await render(
      <Segmented
        label="Appearance"
        value="system"
        options={[
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
    await user.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});
