// One implementation, one address. This file used to carry a verbatim copy of
// the hook components/Toast.tsx already exports, and pages imported the two
// interchangeably — which is exactly how copies drift apart.
export { useToast } from '../components/Toast';
