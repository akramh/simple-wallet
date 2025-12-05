#!/bin/bash
# Create placeholder PNG icons using ImageMagick or simple base64 PNG

# Simple 1x1 PNG in base64 (we'll scale via echo)
# This creates a minimal valid PNG with purple color

# For icon16.png
base64 -d > icon16.png << 'PNG'
iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASElEQVR4nGL8z8DwnyGa4T8D1ADBGIaMDDCGkfGfAZsBjIyMYBoz/mcgwYCR+AdIMIA1/mfg+E+qC/4zwDX+/4+iAQCZdxVr1Kz3GQAAAABJRU5ErkJggg==
PNG

# For icon32.png
base64 -d > icon32.png << 'PNG'
iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnklEQVR4nO2W0Q3AIAxD3wgswkrswhJswgIswhKs0h9UqVKVOqBK/SPFEo/YJjEA/x4GAIQ55xVjXGudc84Yox9jzDmXtdaUUmmtdc4551yklNdaS0rpvff7XWstoSQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/nWgAPMAAPwHHgEcSbwDvUfV2gAAAABJRU5ErkJggg==
PNG

# For icon48.png
base64 -d > icon48.png << 'PNG'
iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA8klEQVR4nO2YQQ6AIAxE+Y/cxGv4O/gbbmI0KyMJMdFCW6jGRN5qVvMygB6tMSb/XgBgjLHWem+ttdbrnDPGmGuttdbW2rbWeu+11tr3u9Y2RQkhhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQggh9I8LAAB4AwDQ1x8AR+K7AQx9hLkAAAAASUVORK5CYII=
PNG

# For icon128.png
base64 -d > icon128.png << 'PNG'
iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAEMklEQVR4nO3dMY7jOBCA4f//6TmBN5vN5lUCJE0Kb+K3Sb2OAQ/gAQQYRqxYokha8+VLoNEwrPpZtOzp8zzPAa/ru8/3Ph/n+b7P9/P79/O9Px6P5/t/v1+/X7/f7/fr94/j+D7e+/N9vPf7vd/v/X6/X7/f7/fr9/u9X78f5/l8v9+v3+/3vj/fj+M4vu/X7/d7v99/PB7P9/t9Pp/P5/v9fp7n+X6/n8/n8/1+n+d5Pp/P5/P9fp/n+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+/wUAAPy3XgARhc8YV4RHwQAAAABJRU5ErkJggg==
PNG

chmod +x create-icons.sh
