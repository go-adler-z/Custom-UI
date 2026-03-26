import { Injectable } from '@angular/core';

export interface UIComponent {
  id: string;
  type: 'button' | 'input' | 'text' | 'card';
  properties: any;
}

@Injectable({
  providedIn: 'root'
})
export class UiComponentsService {
  private components: UIComponent[] = [];

  constructor() { }

  getComponents(): UIComponent[] {
    return this.components;
  }

  addComponent(type: 'button' | 'input' | 'text' | 'card'): void {
    const newComponent: UIComponent = {
      id: `component-${Date.now()}`,
      type,
      properties: this.getDefaultProperties(type)
    };
    this.components.push(newComponent);
  }

  updateComponent(id: string, properties: any): void {
    const component = this.components.find(c => c.id === id);
    if (component) {
      component.properties = { ...component.properties, ...properties };
    }
  }

  removeComponent(id: string): void {
    this.components = this.components.filter(c => c.id !== id);
  }

  private getDefaultProperties(type: string): any {
    switch (type) {
      case 'button':
        return { label: 'Click Me', color: 'primary', size: 'medium' };
      case 'input':
        return { label: 'Input Field', placeholder: 'Enter text', type: 'text' };
      case 'text':
        return { content: 'Sample Text', fontSize: '16px', color: '#000000' };
      case 'card':
        return { title: 'Card Title', content: 'Card Content', shadow: '2px 2px 8px rgba(0,0,0,0.1)' };
      default:
        return {};
    }
  }
}
