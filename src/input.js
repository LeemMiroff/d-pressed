export class PointerInput {
  constructor(target) {
    this.target = target;
    this.isRightHeld = false;
    this.activePointerId = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleContextMenu = (event) => event.preventDefault();

    target.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    target.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    target.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    target.addEventListener('pointerleave', this.handlePointerLeave, { passive: false });
    target.addEventListener('pointerout', this.handlePointerLeave, { passive: false });
    target.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    window.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  handlePointerDown(event) {
    event.preventDefault();

    if (this.activePointerId !== null) {
      return;
    }

    this.activePointerId = event.pointerId;
    this.isRightHeld = true;

    if (this.target.setPointerCapture) {
      this.target.setPointerCapture(event.pointerId);
    }
  }

  handlePointerUp(event) {
    if (this.activePointerId === null || event.pointerId === this.activePointerId) {
      this.release();
    }
  }

  handlePointerLeave(event) {
    if (event.pointerId === this.activePointerId) {
      this.release();
    }
  }

  handleWindowBlur() {
    this.release();
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.release();
    }
  }

  release() {
    this.isRightHeld = false;
    this.activePointerId = null;
  }

  destroy() {
    this.release();
    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointerup', this.handlePointerUp);
    this.target.removeEventListener('pointercancel', this.handlePointerUp);
    this.target.removeEventListener('pointerleave', this.handlePointerLeave);
    this.target.removeEventListener('pointerout', this.handlePointerLeave);
    this.target.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
