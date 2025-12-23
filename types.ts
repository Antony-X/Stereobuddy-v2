export type Point3 = [number, number, number];

export enum ObjectType {
  POINT = 'point',
  LINE = 'line',
  SEGMENT = 'segment',
  PLANE = 'plane',
  POLYGON = 'polygon',
  PRISM = 'prism',
  CIRCLE = 'circle'
}

export interface GeometryObject {
  id: string;
  type: ObjectType;
  name: string;
  color?: string; // 6-digit hex e.g., #ffffff
  visible: boolean;
  selected?: boolean;
  fixed?: boolean;
  points?: string[];
  data?: {
    position?: Point3;
    normal?: Point3; // For planes and circles
    radius?: number; // For circles
    height?: number;
    [key: string]: any;
  };
}

export enum ConstraintType {
  DISTANCE = 'distance',
  ANGLE = 'angle',
  PARALLEL = 'parallel',
  PERPENDICULAR = 'perpendicular',
  POINT_ON_PLANE = 'pointOnPlane',
  POINT_ON_LINE = 'pointOnLine',
  MIDPOINT = 'midpoint',
  EQUAL_LENGTH = 'equalLength',
  FIXED_COORD = 'fixedCoord'
}

export interface Constraint {
  id: string;
  type: ConstraintType;
  objectIds: string[];
  targetValue?: number;
  tolerance?: number;
  enabled: boolean;
  residual?: number;
}

export interface Step {
  id: string;
  description: string;
  objectIds: string[];
  cameraView?: Point3;
}

export interface CameraPose {
  position: Point3;
  target: Point3;
}

export interface ActionPayload {
  messageType: 'actions' | 'chat';
  thoughtSignature?: string | null;
  text?: string;
  actions?: Array<{
    type: 'addObject' | 'updateObject' | 'removeObject' | 'addConstraint' | 'removeConstraint' | 'setCamera' | 'setNotebookView' | 'setActiveStep' | 'resetScene';
    payload: any;
  }>;
  stepList?: Step[];
  planSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  attachments?: {
    mimeType: string;
    data: string; // base64
  }[];
  timestamp: number;
}