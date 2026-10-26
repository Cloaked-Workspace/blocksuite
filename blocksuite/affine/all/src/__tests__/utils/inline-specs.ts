import { CommentInlineSpecExtension } from '@blocksuite/affine-inline-comment';
import { FootNoteInlineSpecExtension } from '@blocksuite/affine-inline-footnote';
import { LatexInlineSpecExtension } from '@blocksuite/affine-inline-latex';
import { LinkInlineSpecExtension } from '@blocksuite/affine-inline-link';
import { MentionInlineSpecExtension } from '@blocksuite/affine-inline-mention';
import {
  BackgroundInlineSpecExtension,
  BoldInlineSpecExtension,
  CodeInlineSpecExtension,
  ColorInlineSpecExtension,
  ItalicInlineSpecExtension,
  StrikeInlineSpecExtension,
  UnderlineInlineSpecExtension,
} from '@blocksuite/affine-inline-preset';
import { ReferenceInlineSpecExtension } from '@blocksuite/affine-inline-reference';

// The specs `DefaultInlineManagerExtension` resolves, in its order.
export const defaultInlineSpecExtensions = [
  BoldInlineSpecExtension,
  ItalicInlineSpecExtension,
  UnderlineInlineSpecExtension,
  StrikeInlineSpecExtension,
  CodeInlineSpecExtension,
  BackgroundInlineSpecExtension,
  ColorInlineSpecExtension,
  LatexInlineSpecExtension,
  ReferenceInlineSpecExtension,
  LinkInlineSpecExtension,
  FootNoteInlineSpecExtension,
  MentionInlineSpecExtension,
  CommentInlineSpecExtension,
];
