/**
 * Hand-authored React visual for the ingested `Badge` component. The catalog governs the
 * name, the `variant` enum, and the `label` prop; this file supplies only the pixels.
 */
import type { FC } from "react";
import { BadgeView } from "./BadgeView";

export const BadgeRender: FC<any> = ({ props }) => (
  <BadgeView variant={props.variant}>{props.label}</BadgeView>
);
