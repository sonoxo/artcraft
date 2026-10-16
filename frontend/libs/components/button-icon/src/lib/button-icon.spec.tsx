import { fireEvent, render, screen } from '@testing-library/react';
import { PlayIcon } from 'lucide-react';
import { vi } from 'vitest';

import { ButtonIcon } from './button-icon';

describe('ButtonIcon', () => {
  
  it('should render successfully', () => {
    const onClick = vi.fn();
    const { baseElement } = render(<ButtonIcon icon={PlayIcon} onClick={onClick} />);
    expect(baseElement).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
  
});
