import { render, screen } from '@testing-library/react';

import { Badge } from './badge';

describe('Badge', () => {
  
  it('should render successfully', () => {
    const { baseElement } = render(<Badge label="Ready" />);
    expect(baseElement).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  
});
