import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  window.history.pushState({}, '', '/account');
});

test('renders the user account page route', () => {
  render(<App />);
  expect(screen.getAllByText(/User Account Profile/i).length).toBeGreaterThan(0);
});

test('shows the client creation form on the dedicated create-client page', () => {
  window.history.pushState({}, '', '/clients/new');
  render(<App />);

  expect(screen.getByRole('heading', { name: /create client profile/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/client name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
});

test('shows admin controls to edit or deactivate user accounts', () => {
  window.history.pushState({}, '', '/users');
  render(<App />);

  const editButtons = screen.getAllByRole('button', { name: /edit user/i });
  const deactivateButtons = screen.getAllByRole('button', { name: /deactivate|activate/i });

  expect(editButtons.length).toBeGreaterThan(0);
  expect(deactivateButtons.length).toBeGreaterThan(0);
});

test('keeps the logged-in user role read-only on the profile page', () => {
  window.history.pushState({}, '', '/account');
  render(<App />);

  const roleInput = screen.getByDisplayValue('ADMIN');
  expect(roleInput).toHaveAttribute('readonly');
});
