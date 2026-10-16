import { render, screen } from '@testing-library/react';

import { FileUploader } from './file-uploader';

describe('FileUploader', () => {
  
  it('should render successfully', () => {
    const { baseElement } = render(
      <FileUploader files={[]} fileTypes={['PNG', 'JPG']} handleChange={() => {}} />,
    );
    expect(baseElement).toBeTruthy();
    expect(screen.getByText('Upload a file')).toBeTruthy();
    expect(screen.getByText('PNG, JPG supported')).toBeTruthy();
  });
  
});
