//
//  KBImageView.m
//  Keybase
//
//  Created by Gabriel on 1/9/15.
//  Copyright (c) 2015 Gabriel Handford. All rights reserved.
//

#import "KBImageView.h"

@implementation KBImageView

//- (instancetype)initWithFrame:(NSRect)frame {
//  if ((self = [super initWithFrame:frame])) {
//    [self unregisterDraggedTypes];
//  }
//  return self;
//}

- (BOOL)mouseDownCanMoveWindow {
  return YES;
}

- (void)setURLString:(NSString *)URLString {
  _URLString = URLString;
  if (URLString) {
    NSImage *image = [[NSImage alloc] initWithContentsOfURL:[NSURL URLWithString:URLString]];
    self.image = image;
  } else {
    self.image = nil;
  }
}

- (void)setFrame:(NSRect)frame {
  [super setFrame:frame];
  if (_roundedRatio > 0) {
    [self setRounded:roundf(frame.size.width/2.0)];
  }
}

- (void)setRounded:(CGFloat)cornerRadius {
  [self setWantsLayer: YES];
  self.layer.borderWidth = 1.0;
  self.layer.cornerRadius = cornerRadius;
  self.layer.masksToBounds = YES;
}

@end
