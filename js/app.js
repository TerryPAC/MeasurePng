import { ImageProcessorApp } from './uiController.js';

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  const app = new ImageProcessorApp();
  app.init();
});
