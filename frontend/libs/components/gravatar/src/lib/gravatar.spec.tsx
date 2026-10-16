import { fireEvent, render, screen } from '@testing-library/react';

import { Gravatar } from './gravatar';
import EnvironmentVariables from './environment-variables';

describe('Gravatar', () => {
  
  it('should render successfully', () => {
    EnvironmentVariables.initialize({ GRAVATAR_API: 'https://www.gravatar.com' });
    const { baseElement } = render(
      <Gravatar size={48} username="Artist" email_hash="test-avatar" avatarIndex={2} />,
    );
    expect(baseElement).toBeTruthy();
    const avatar = screen.getByRole('img', { name: "Artist's gravatar" });
    expect(avatar.getAttribute('src')).toContain('https://www.gravatar.com/avatar/test-avatar?s=48');
    fireEvent.error(avatar);
    expect(avatar.getAttribute('src')).toBe('/resources/avatars/2.webp');
  });
  
});
